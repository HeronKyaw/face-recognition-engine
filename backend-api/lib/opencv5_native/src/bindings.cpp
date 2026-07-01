#include "face_engine.hpp"
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

namespace py = pybind11;

PYBIND11_MODULE(opencv5_native, m) {
    m.doc() = "OpenCV 5 native face recognition engine";

    py::class_<FaceEngine>(m, "FaceEngine")
        .def(py::init<const std::string&, int, int>(),
             py::arg("face_detect_model"),
             py::arg("input_size") = 112,
             py::arg("embedding_dim") = 512)
        .def("extract_embedding", &FaceEngine::extractEmbedding,
             py::arg("image_bytes"),
             "Extract aligned face pixels from encoded image bytes (JPEG/PNG)")
        .def("extract_embedding_from_raw", &FaceEngine::extractEmbeddingFromRaw,
             py::arg("raw_pixels"), py::arg("width"), py::arg("height"),
             "Extract aligned face pixels from raw BGR pixel data")
        .def("detect_align_and_get_pixels", &FaceEngine::detectAlignAndGetPixels,
             py::arg("image_bytes"),
             "Detect, align face and return 112x112 RGB pixels")
        .def("health_check", &FaceEngine::healthCheck,
             "Check if the engine is functioning correctly");
}
