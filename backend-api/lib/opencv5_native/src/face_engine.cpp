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
constexpr cv::Scalar MEAN_VAL(127.5, 127.5, 127.5);

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

        faceDetector_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
        faceDetector_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
        recognitionNet_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
        recognitionNet_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
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

    if (output.empty() || output.size[2] == 0) {
        throw std::runtime_error("No face detected");
    }

    cv::Mat detections(output.size[2], output.size[3], CV_32F, output.ptr<float>(0, 0));

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

    std::vector<cv::Point2f> src(5);
    src[0] = cv::Point2f(d[7], d[8]);    // left eye (YuNet[1])
    src[1] = cv::Point2f(d[5], d[6]);    // right eye (YuNet[0])
    src[2] = cv::Point2f(d[9], d[10]);   // nose tip (YuNet[2])
    src[3] = cv::Point2f(d[13], d[14]);  // left mouth corner (YuNet[4])
    src[4] = cv::Point2f(d[11], d[12]);  // right mouth corner (YuNet[3])

    cv::Mat tform = cv::estimateAffinePartial2D(src, CANONICAL_LANDMARKS);
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

    cv::Mat blob = cv::dnn::blobFromImage(
        resized, SCALE_FACTOR, cv::Size(inputSize_, inputSize_),
        MEAN_VAL, true, false, CV_32F);

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
