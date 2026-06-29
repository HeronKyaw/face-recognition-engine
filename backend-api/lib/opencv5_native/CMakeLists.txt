cmake_minimum_required(VERSION 3.16)
project(opencv5_native VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(FetchContent)
FetchContent_Declare(
    pybind11
    GIT_REPOSITORY https://github.com/pybind/pybind11.git
    GIT_TAG v2.12.0
)
FetchContent_MakeAvailable(pybind11)

find_package(OpenCV REQUIRED COMPONENTS core imgproc dnn)
if(OpenCV_VERSION VERSION_LESS "5.0.0")
    message(FATAL_ERROR "OpenCV 5.x required, found ${OpenCV_VERSION}")
endif()

pybind11_add_module(opencv5_native
    src/face_engine.cpp
    src/bindings.cpp
)

target_include_directories(opencv5_native
    PRIVATE
        ${OpenCV_INCLUDE_DIRS}
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(opencv5_native
    PRIVATE
        ${OpenCV_LIBS}
)

set_target_properties(opencv5_native PROPERTIES
    Python3_INCLUDE_DIRS ${Python3_INCLUDE_DIRS}
)
