#pragma once

#include <opencv2/core.hpp>
#include <opencv2/dnn.hpp>
#include <vector>
#include <string>
#include <cstdint>

class FaceEngine {
public:
    FaceEngine(const std::string& faceDetectModel,
               const std::string& recModel,
               int inputSize = 112,
               int embeddingDim = 512);
    ~FaceEngine() = default;

    std::vector<float> extractEmbedding(const std::vector<uint8_t>& imageBytes);
    std::vector<float> extractEmbeddingFromRaw(const std::vector<uint8_t>& rawPixels,
                                                int width, int height);
    bool healthCheck();

    static const std::vector<cv::Point2f> CANONICAL_LANDMARKS;

private:
    cv::Mat detectAndAlignFace(const cv::Mat& image, const cv::Size& targetSize);
    cv::Mat preprocessForRecognition(const cv::Mat& face);
    std::vector<float> normalizeEmbedding(const cv::Mat& rawOutput);

    cv::dnn::Net faceDetector_;
    cv::dnn::Net recognitionNet_;
    int inputSize_;
    int embeddingDim_;
};
