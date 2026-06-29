# =============================================================
# Stage 1: Build OpenCV 5 from source
# =============================================================
FROM python:3.11-slim-bookworm AS opencv-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ninja-build \
    pkg-config \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libtbb-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone --depth=1 --branch=5.x https://github.com/opencv/opencv.git

WORKDIR /opt/opencv/build

RUN cmake -GNinja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/opencv/install \
    -DBUILD_EXAMPLES=OFF \
    -DBUILD_TESTS=OFF \
    -DBUILD_PERF_TESTS=OFF \
    -DBUILD_JAVA=OFF \
    -DBUILD_PYTHON=OFF \
    -DBUILD_opencv_python3=OFF \
    -DBUILD_opencv_python_bindings_generator=OFF \
    -DBUILD_opencv_java_bindings_generator=OFF \
    -DBUILD_opencv_ts=OFF \
    -DBUILD_opencv_apps=OFF \
    -DBUILD_SHARED_LIBS=ON \
    -DWITH_IPP=OFF \
    -DWITH_FFMPEG=ON \
    -DWITH_GSTREAMER=OFF \
    -DWITH_V4L=ON \
    -DWITH_GTK=OFF \
    -DWITH_OPENCL=OFF \
    -DWITH_TBB=ON \
    -DWITH_EIGEN=ON \
    -DBUILD_opencv_dnn=ON \
    -DBUILD_opencv_imgproc=ON \
    -DBUILD_opencv_imgcodecs=ON \
    -DBUILD_opencv_core=ON \
    -DBUILD_opencv_videoio=OFF \
    -DBUILD_opencv_highgui=OFF \
    -DBUILD_opencv_flann=OFF \
    -DBUILD_opencv_features2d=OFF \
    -DBUILD_opencv_calib3d=OFF \
    -DBUILD_opencv_objdetect=OFF \
    -DBUILD_opencv_photo=OFF \
    -DBUILD_opencv_stitching=OFF \
    -DBUILD_opencv_ml=OFF \
    /opt/opencv && \
    ninja install && \
    rm -rf /opt/opencv/build

# =============================================================
# Stage 2: Build C++ Python extension (opencv5_native)
# =============================================================
FROM python:3.11-slim-bookworm AS extension-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

COPY --from=opencv-builder /opt/opencv/install /opt/opencv/install

ENV OpenCV_DIR=/opt/opencv/install/lib/cmake/opencv5

WORKDIR /build
COPY lib/opencv5_native/ lib/opencv5_native/

RUN cd lib/opencv5_native && \
    cmake -GNinja -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH=/opt/opencv/install \
    -DPython3_EXECUTABLE=$(which python3) && \
    cmake --build build && \
    mkdir -p /opt/extension && \
    cp build/opencv5_native*.so /opt/extension/

# =============================================================
# Stage 3: Runtime image
# =============================================================
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    libgcc-s1 \
    libopenblas0 \
    libtbb12 \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=opencv-builder /opt/opencv/install/lib /usr/local/lib
RUN ldconfig

COPY --from=extension-builder /opt/extension/opencv5_native*.so /usr/local/lib/python3.11/site-packages/

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

ENV HF_HOME=/app/.cache/huggingface
RUN mkdir -p $HF_HOME && \
    python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='garavv/arcface-onnx', filename='arc.onnx')" && \
    mkdir -p /app/models && \
    wget -q -O /app/models/face_detection_yunet_2026may.onnx \
        https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
