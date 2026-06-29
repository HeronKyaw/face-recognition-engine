#include "face_engine.hpp"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/dnn.hpp>
#include <stdexcept>
#include <cmath>
#include <cstring>

namespace {

constexpr float CONFIDENCE_THRESHOLD = 0.5f;
constexpr int FACE_DETECT_INPUT_SIZE = 320;
constexpr float SCALE_FACTOR = 1.0f / 128.0f;
const cv::Scalar MEAN_VAL(127.5, 127.5, 127.5);

cv::Mat computeAffineTransform(const std::vector<cv::Point2f>& src,
                                const std::vector<cv::Point2f>& dst) {
    cv::Mat A = (cv::Mat_<float>(3, 3) <<
        src[0].x, src[0].y, 1.0f,
        src[1].x, src[1].y, 1.0f,
        src[2].x, src[2].y, 1.0f);
    cv::Mat bx = (cv::Mat_<float>(3, 1) << dst[0].x, dst[1].x, dst[2].x);
    cv::Mat by = (cv::Mat_<float>(3, 1) << dst[0].y, dst[1].y, dst[2].y);
    cv::Mat ax, ay;
    cv::solve(A, bx, ax, cv::DECOMP_SVD);
    cv::solve(A, by, ay, cv::DECOMP_SVD);
    cv::Mat tform(2, 3, CV_32F);
    tform.at<float>(0, 0) = ax.at<float>(0);
    tform.at<float>(0, 1) = ax.at<float>(1);
    tform.at<float>(0, 2) = ax.at<float>(2);
    tform.at<float>(1, 0) = ay.at<float>(0);
    tform.at<float>(1, 1) = ay.at<float>(1);
    tform.at<float>(1, 2) = ay.at<float>(2);
    return tform;
}

}  // anonymous namespace

const std::vector<cv::Point2f> FaceEngine::CANONICAL_LANDMARKS = {
    {38.2946f, 51.6963f},
    {73.5318f, 51.5014f},
    {56.0252f, 71.7366f},
    {41.5493f, 92.3655f},
    {70.7299f, 92.2041f},
};

FaceEngine::FaceEngine(const std::string& faceDetectModel,
                       const std::string& recModel,
                       int inputSize,
                       int embeddingDim)
    : inputSize_(inputSize), embeddingDim_(embeddingDim)
{
    try {
        faceDetector_ = cv::dnn::readNetFromONNX(faceDetectModel);
        recognitionNet_ = cv::dnn::readNetFromONNX(recModel);
    } catch (const cv::Exception& e) {
        throw std::runtime_error("Failed to load ONNX models: " + std::string(e.what()));
    }
}

cv::Mat FaceEngine::detectAndAlignFace(const cv::Mat& image, const cv::Size& targetSize) {
    cv::Mat blob = cv::dnn::blobFromImage(
        image, SCALE_FACTOR, cv::Size(FACE_DETECT_INPUT_SIZE, FACE_DETECT_INPUT_SIZE),
        MEAN_VAL, true, false, CV_32F);

    faceDetector_.setInput(blob);
    cv::Mat output = faceDetector_.forward();

    if (output.empty()) {
        throw std::runtime_error("No face detected");
    }

    cv::Mat detections;
    int numDetections = 0;
    int dataSize = 0;

    if (output.dims == 4) {
        numDetections = output.size[2];
        dataSize = output.size[3];
        detections = cv::Mat(numDetections, dataSize, CV_32F, output.ptr<float>(0, 0));
    } else if (output.dims == 3) {
        numDetections = output.size[1];
        dataSize = output.size[2];
        detections = cv::Mat(numDetections, dataSize, CV_32F, output.ptr<float>(0, 0));
    } else if (output.dims == 2) {
        numDetections = output.rows;
        dataSize = output.cols;
        detections = output;
    } else {
        throw std::runtime_error("Unexpected detection output shape");
    }

    if (numDetections == 0) {
        throw std::runtime_error("No face detected");
    }

    int bestIdx = -1;
    float bestConf = 0.0f;
    for (int i = 0; i < detections.rows; ++i) {
        float conf = detections.at<float>(i, 4);
        if (conf > bestConf && conf >= CONFIDENCE_THRESHOLD) {
            bestConf = conf;
            bestIdx = i;
        }
    }

    if (bestIdx < 0) {
        throw std::runtime_error("No face detected above confidence threshold");
    }

    const float* d = detections.ptr<float>(bestIdx);

    // Use 3 stable landmarks (left eye, right eye, nose tip) for alignment
    std::vector<cv::Point2f> src = {
        cv::Point2f(d[7], d[8]),    // left eye (YuNet[1])
        cv::Point2f(d[5], d[6]),    // right eye (YuNet[0])
        cv::Point2f(d[9], d[10]),   // nose tip (YuNet[2])
    };
    std::vector<cv::Point2f> dst = {
        CANONICAL_LANDMARKS[0],
        CANONICAL_LANDMARKS[1],
        CANONICAL_LANDMARKS[2],
    };

    cv::Mat tform = computeAffineTransform(src, dst);
    if (tform.empty()) {
        throw std::runtime_error("Face alignment failed");
    }

    cv::Mat aligned;
    cv::warpAffine(image, aligned, tform, targetSize,
                   cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar(127, 127, 127));

    return aligned;
}

cv::Mat FaceEngine::preprocessForRecognition(const cv::Mat& face) {
    cv::Mat resized;
    cv::resize(face, resized, cv::Size(inputSize_, inputSize_), 0, 0, cv::INTER_LINEAR);

    int sizes[] = {1, inputSize_, inputSize_, 3};
    cv::Mat blob(4, sizes, CV_32F);

    for (int h = 0; h < inputSize_; ++h) {
        for (int w = 0; w < inputSize_; ++w) {
            const cv::Vec3b& pixel = resized.at<cv::Vec3b>(h, w);
            float* ptr = blob.ptr<float>(0, h, w);
            ptr[0] = (static_cast<float>(pixel[2]) - MEAN_VAL[0]) * SCALE_FACTOR;
            ptr[1] = (static_cast<float>(pixel[1]) - MEAN_VAL[1]) * SCALE_FACTOR;
            ptr[2] = (static_cast<float>(pixel[0]) - MEAN_VAL[2]) * SCALE_FACTOR;
        }
    }

    return blob;
}

std::vector<float> FaceEngine::normalizeEmbedding(const cv::Mat& rawOutput) {
    CV_Assert(rawOutput.isContinuous());
    const float* data = rawOutput.ptr<float>();
    size_t total = rawOutput.total();

    double sumSq = 0.0;
    for (size_t i = 0; i < total; ++i) {
        sumSq += static_cast<double>(data[i]) * data[i];
    }

    double norm = std::sqrt(sumSq);
    std::vector<float> embedding(total);
    if (norm > 1e-6) {
        float invNorm = 1.0f / static_cast<float>(norm);
        for (size_t i = 0; i < total; ++i) {
            embedding[i] = data[i] * invNorm;
        }
    }

    return embedding;
}

std::vector<float> FaceEngine::extractEmbedding(const std::vector<uint8_t>& imageBytes) {
    cv::Mat image = cv::imdecode(imageBytes, cv::IMREAD_COLOR);
    if (image.empty()) {
        throw std::runtime_error("Failed to decode image bytes");
    }

    cv::Mat alignedFace = detectAndAlignFace(image, cv::Size(inputSize_, inputSize_));

    cv::Mat blob = preprocessForRecognition(alignedFace);

    recognitionNet_.setInput(blob);
    cv::Mat output = recognitionNet_.forward();

    return normalizeEmbedding(output);
}

std::vector<float> FaceEngine::extractEmbeddingFromRaw(
    const std::vector<uint8_t>& rawPixels, int width, int height)
{
    cv::Mat image(height, width, CV_8UC3, const_cast<uint8_t*>(rawPixels.data()));
    image = image.clone();

    cv::Mat alignedFace = detectAndAlignFace(image, cv::Size(inputSize_, inputSize_));

    cv::Mat blob = preprocessForRecognition(alignedFace);

    recognitionNet_.setInput(blob);
    cv::Mat output = recognitionNet_.forward();

    return normalizeEmbedding(output);
}

bool FaceEngine::healthCheck() {
    try {
        std::vector<uint8_t> dummy(112 * 112 * 3, 128);
        cv::Mat dummyMat(112, 112, CV_8UC3, dummy.data());
        cv::Mat blob = preprocessForRecognition(dummyMat);
        recognitionNet_.setInput(blob);
        cv::Mat output = recognitionNet_.forward();
        return !output.empty();
    } catch (...) {
        return false;
    }
}
