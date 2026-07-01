#include "face_engine.hpp"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/dnn.hpp>
#include <stdexcept>
#include <algorithm>
#include <cmath>
#include <vector>
#include <string>
#include <sstream>

namespace {

constexpr float CONFIDENCE_THRESHOLD = 0.5f;
constexpr float NMS_THRESHOLD = 0.3f;
constexpr int FACE_DETECT_INPUT_SIZE = 320;
constexpr float SCALE_FACTOR = 1.0f / 255.0f;
const cv::Scalar MEAN_VAL(0.0, 0.0, 0.0);

inline float sigmoid(float x) {
    return 1.0f / (1.0f + std::exp(-x));
}

struct Detection {
    cv::Rect2f box;
    float confidence;
    cv::Point2f landmarks[5];
};

float iou(const cv::Rect2f& a, const cv::Rect2f& b) {
    float ix = std::max(a.x, b.x);
    float iy = std::max(a.y, b.y);
    float iw = std::min(a.x + a.width, b.x + b.width) - ix;
    float ih = std::min(a.y + a.height, b.y + b.height) - iy;
    if (iw <= 0 || ih <= 0) return 0.0f;
    float inter = iw * ih;
    float uni = a.width * a.height + b.width * b.height - inter;
    return inter / uni;
}

void decodeScale(const float* cls, const float* obj,
                 const float* bbox, const float* kps,
                 int gridH, int gridW, int stride,
                 float scaleX, float scaleY,
                 std::vector<Detection>& detections) {
    for (int row = 0; row < gridH; ++row) {
        for (int col = 0; col < gridW; ++col) {
            int idx = row * gridW + col;
            float conf = sigmoid(cls[idx]);
            if (conf < CONFIDENCE_THRESHOLD) continue;

            float cx_a = (col + 0.5f) * stride;
            float cy_a = (row + 0.5f) * stride;

            float dx = bbox[idx * 4 + 0];
            float dy = bbox[idx * 4 + 1];
            float dw = bbox[idx * 4 + 2];
            float dh = bbox[idx * 4 + 3];

            float cx = cx_a + dx * stride;
            float cy = cy_a + dy * stride;
            float w = std::exp(dw) * stride;
            float h = std::exp(dh) * stride;

            Detection det;
            det.confidence = conf;
            det.box = cv::Rect2f((cx - w / 2) * scaleX,
                                 (cy - h / 2) * scaleY,
                                 w * scaleX, h * scaleY);

            for (int k = 0; k < 5; ++k) {
                float lx = (cx_a + kps[idx * 10 + k * 2] * stride) * scaleX;
                float ly = (cy_a + kps[idx * 10 + k * 2 + 1] * stride) * scaleY;
                det.landmarks[k] = cv::Point2f(lx, ly);
            }

            detections.push_back(det);
        }
    }
}

std::vector<Detection> nms(std::vector<Detection>& dets) {
    std::sort(dets.begin(), dets.end(),
              [](const Detection& a, const Detection& b) {
                  return a.confidence > b.confidence;
              });
    std::vector<Detection> result;
    std::vector<bool> suppressed(dets.size(), false);
    for (size_t i = 0; i < dets.size(); ++i) {
        if (suppressed[i]) continue;
        result.push_back(dets[i]);
        for (size_t j = i + 1; j < dets.size(); ++j) {
            if (!suppressed[j] && iou(dets[i].box, dets[j].box) > NMS_THRESHOLD) {
                suppressed[j] = true;
            }
        }
    }
    return result;
}

cv::Mat computeAffineTransform(const std::vector<cv::Point2f>& src,
                                const std::vector<cv::Point2f>& dst) {
    cv::Mat A = (cv::Mat_<float>(3, 3) <<
        src[0].x, src[0].y, 1.0f,
        src[1].x, src[1].y, 1.0f,
        src[2].x, src[2].y, 1.0f);
    float det = cv::determinant(A);
    if (std::abs(det) < 1e-9f) return cv::Mat();
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
                       int inputSize,
                       int embeddingDim)
    : inputSize_(inputSize), embeddingDim_(embeddingDim)
{
    faceDetector_ = cv::dnn::readNetFromONNX(faceDetectModel);
    if (faceDetector_.empty()) {
        throw std::runtime_error("Failed to load face detection model: " + faceDetectModel);
    }
}

cv::Mat FaceEngine::detectAndAlignFace(const cv::Mat& image, const cv::Size& targetSize) {
    int origH = image.rows, origW = image.cols;
    float scaleX = static_cast<float>(origW) / FACE_DETECT_INPUT_SIZE;
    float scaleY = static_cast<float>(origH) / FACE_DETECT_INPUT_SIZE;

    cv::Mat blob = cv::dnn::blobFromImage(
        image, SCALE_FACTOR, cv::Size(FACE_DETECT_INPUT_SIZE, FACE_DETECT_INPUT_SIZE),
        MEAN_VAL, true, false, CV_32F);

    faceDetector_.setInput(blob);

    std::vector<cv::String> outNames = faceDetector_.getUnconnectedOutLayersNames();
    std::vector<cv::Mat> outputs;
    faceDetector_.forward(outputs, outNames);

    if (outputs.size() < 12) {
        throw std::runtime_error("Face detection: unexpected number of outputs");
    }

    int grid8 = FACE_DETECT_INPUT_SIZE / 8;
    int grid16 = FACE_DETECT_INPUT_SIZE / 16;
    int grid32 = FACE_DETECT_INPUT_SIZE / 32;

    std::vector<Detection> detections;

    auto scanScale = [&](const float* cls, const float* obj,
                         const float* bbox, const float* kps,
                         int gridH, int gridW, int stride,
                         float& maxCls, float& maxObj) {
        for (int r = 0; r < gridH; ++r) {
            for (int c = 0; c < gridW; ++c) {
                int idx = r * gridW + c;
                float sc = sigmoid(cls[idx]);
                float so = sigmoid(obj[idx]);
                if (sc > maxCls) maxCls = sc;
                if (so > maxObj) maxObj = so;
            }
        }
    };

    float maxCls = 0, maxObj = 0;
    int g8 = grid8, g16 = grid16, g32 = grid32;
    scanScale(outputs[0].ptr<float>(), outputs[3].ptr<float>(), nullptr, nullptr,
              g8, g8, 8, maxCls, maxObj);
    scanScale(outputs[1].ptr<float>(), outputs[4].ptr<float>(), nullptr, nullptr,
              g16, g16, 16, maxCls, maxObj);
    scanScale(outputs[2].ptr<float>(), outputs[5].ptr<float>(), nullptr, nullptr,
              g32, g32, 32, maxCls, maxObj);

    decodeScale(outputs[0].ptr<float>(), outputs[3].ptr<float>(),
                outputs[6].ptr<float>(), outputs[9].ptr<float>(),
                g8, g8, 8, scaleX, scaleY, detections);
    decodeScale(outputs[1].ptr<float>(), outputs[4].ptr<float>(),
                outputs[7].ptr<float>(), outputs[10].ptr<float>(),
                g16, g16, 16, scaleX, scaleY, detections);
    decodeScale(outputs[2].ptr<float>(), outputs[5].ptr<float>(),
                outputs[8].ptr<float>(), outputs[11].ptr<float>(),
                g32, g32, 32, scaleX, scaleY, detections);

    if (detections.empty()) {
        std::stringstream ss;
        ss << "No face detected (maxCls=" << maxCls << " maxObj=" << maxObj << ")";
        throw std::runtime_error(ss.str());
    }

    auto kept = nms(detections);
    if (kept.empty()) {
        std::stringstream ss;
        ss << "No face detected after NMS";
        throw std::runtime_error(ss.str());
    }

    const Detection& best = kept[0];
    if (best.confidence < 0.7f) {
        std::stringstream ss;
        ss << "No face detected (low_confidence=" << best.confidence << ")";
        throw std::runtime_error(ss.str());
    }
    std::vector<cv::Point2f> src = {
        best.landmarks[0], best.landmarks[1], best.landmarks[2]
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
    try {
        cv::warpAffine(image, aligned, tform, targetSize,
                       cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar(127, 127, 127));
    } catch (const cv::Exception&) {
        throw std::runtime_error("Face alignment failed");
    }

    cv::Scalar mean, stddev;
    cv::meanStdDev(aligned, mean, stddev);
    float grayStddev = static_cast<float>((stddev[0] + stddev[1] + stddev[2]) / 3.0);
    if (grayStddev < 2.0f) {
        std::stringstream ss;
        ss << "No face detected (aligned_stddev=" << grayStddev << ")";
        throw std::runtime_error(ss.str());
    }

    cv::Mat ycrcb;
    cv::cvtColor(aligned, ycrcb, cv::COLOR_BGR2YCrCb);
    cv::Mat skinMask;
    cv::inRange(ycrcb, cv::Scalar(0, 130, 75), cv::Scalar(255, 180, 130), skinMask);
    double skinRatio = cv::countNonZero(skinMask) / static_cast<double>(aligned.total());
    if (skinRatio < 0.3) {
        std::stringstream ss;
        ss << "No face detected (skin_ratio=" << skinRatio << ")";
        throw std::runtime_error(ss.str());
    }

    return aligned;
}

std::vector<float> FaceEngine::extractEmbedding(const std::vector<uint8_t>& imageBytes) {
    cv::Mat image = cv::imdecode(imageBytes, cv::IMREAD_COLOR);
    if (image.empty()) {
        throw std::runtime_error("Failed to decode image bytes");
    }

    cv::Mat alignedFace = detectAndAlignFace(image, cv::Size(inputSize_, inputSize_));

    std::vector<float> pixels;
    pixels.reserve(inputSize_ * inputSize_ * 3);
    for (int h = 0; h < inputSize_; ++h) {
        for (int w = 0; w < inputSize_; ++w) {
            const cv::Vec3b& pixel = alignedFace.at<cv::Vec3b>(h, w);
            pixels.push_back(static_cast<float>(pixel[0]));  // B
            pixels.push_back(static_cast<float>(pixel[1]));  // G
            pixels.push_back(static_cast<float>(pixel[2]));  // R
        }
    }
    return pixels;
}

std::vector<float> FaceEngine::extractEmbeddingFromRaw(
    const std::vector<uint8_t>& rawPixels, int width, int height)
{
    cv::Mat image(height, width, CV_8UC3, const_cast<uint8_t*>(rawPixels.data()));
    image = image.clone();

    cv::Mat alignedFace = detectAndAlignFace(image, cv::Size(inputSize_, inputSize_));

    std::vector<float> pixels;
    pixels.reserve(inputSize_ * inputSize_ * 3);
    for (int h = 0; h < inputSize_; ++h) {
        for (int w = 0; w < inputSize_; ++w) {
            const cv::Vec3b& pixel = alignedFace.at<cv::Vec3b>(h, w);
            pixels.push_back(static_cast<float>(pixel[0]));  // B
            pixels.push_back(static_cast<float>(pixel[1]));  // G
            pixels.push_back(static_cast<float>(pixel[2]));  // R
        }
    }
    return pixels;
}

std::vector<float> FaceEngine::detectAlignAndGetPixels(const std::vector<uint8_t>& imageBytes) {
    return extractEmbedding(imageBytes);
}

bool FaceEngine::healthCheck() {
    try {
        if (faceDetector_.empty()) {
            return false;
        }
        int w = 320, h = 320;
        cv::Mat testImg(h, w, CV_8UC3, cv::Scalar(100, 100, 100));
        cv::ellipse(testImg, cv::Point(w/2, h/2), cv::Size(100, 140), 0, 0, 360,
                    cv::Scalar(200, 180, 160), -1);
        std::vector<uint8_t> buf;
        if (!cv::imencode(".jpg", testImg, buf)) {
            return false;
        }
        cv::Mat decoded = cv::imdecode(buf, cv::IMREAD_COLOR);
        return !decoded.empty() && decoded.rows == h && decoded.cols == w;
    } catch (...) {
        return false;
    }
}
