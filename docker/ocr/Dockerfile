# 使用官方轻量 Python 镜像作为底座
FROM python:3.9-slim

# 设置清华源加速（国内部署必备）
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 安装系统级依赖（OCR 运行必备）
# 安装系统级依赖 (OCR 运行必备)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*


# 安装 PaddlePaddle (CPU版) 和 PaddleOCR
RUN pip install --upgrade pip && \
    pip install --no-cache-dir \
    paddlepaddle \
    paddleocr \
    fastapi \
    uvicorn \
    python-multipart

# 预下载 PP-OCRv4 识别模型（避免容器启动时才下载导致慢）
RUN python3 -c "from paddleocr import PaddleOCR; PaddleOCR(lang='ch', enable_mkldnn=False, use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True, ocr_version='PP-OCRv4', text_det_limit_side_len=1280)"

WORKDIR /app
COPY . .

EXPOSE 8866
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8866"]
