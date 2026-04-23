"""验光图 OCR 服务。须在 import paddle 之前关闭 oneDNN，避免部分镜像内 NotImplementedError。"""
import os

os.environ.setdefault("FLAGS_use_mkldnn", "0")

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
import numpy as np
import cv2

app = FastAPI()
# 浏览器收银台直连 8866 时需跨域（与 Next 开发/部署域名不同端口）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# enable_mkldnn=False：避免 Paddle 3.3 + oneDNN/PIR 在 CPU 上的已知崩溃
# 关闭文档方向/拉平（UVDoc），否则每张图多跑两个大模型，CPU 上极慢
# PP-OCRv4 + mobile：比默认 PP-OCRv5 server 轻量一个数量级
ocr = PaddleOCR(
    lang="ch",
    enable_mkldnn=False,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
    ocr_version="PP-OCRv4",
    text_det_limit_side_len=1280,
)

# 预处理：限制输入长边，减轻旋转/二值化/检测耗时（识别不再放大回原图）
_OCR_INPUT_MAX_EDGE = 1280
# 自适应阈值：块大小须为奇数，随短边缩放避免过小图块过大
_ADAPT_BLOCK_MIN = 11
_ADAPT_BLOCK_MAX = 51
_ADAPT_C = 9


def _estimate_skew_angle_deg(gray: np.ndarray) -> float:
    """
    用 Otsu 反二值化后前景像素拟合 minAreaRect，估计整页倾斜角（度）。
    角过大或点数过少时返回 0，避免误旋。
    """
    if gray.size == 0:
        return 0.0
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ys, xs = np.where(thresh > 0)
    if xs.size < 200:
        return 0.0
    coords = np.column_stack((xs.astype(np.float32), ys.astype(np.float32)))
    rect = cv2.minAreaRect(coords)
    angle = float(rect[-1])
    # OpenCV minAreaRect 角度约定：归一到 [-45, 45] 近似为「需纠正的旋转」
    if angle < -45.0:
        angle = 90.0 + angle
    else:
        angle = -angle
    if abs(angle) > 40.0:
        return 0.0
    if abs(angle) < 0.25:
        return 0.0
    return angle


def _rotate_bound(image: np.ndarray, angle_deg: float) -> np.ndarray:
    """绕图像中心旋转，边界用复制填充，减少黑边裁切对字的影响。"""
    if abs(angle_deg) < 0.05:
        return image
    h, w = image.shape[:2]
    center = (w * 0.5, h * 0.5)
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    return cv2.warpAffine(
        image,
        m,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def preprocess_rx_image(bgr: np.ndarray) -> np.ndarray:
    """
    手写验光单增强：灰度 → 倾斜估计与校正 → 自适应二值化 → 转 BGR 供 PaddleOCR。
    """
    if bgr is None or bgr.size == 0:
        return bgr

    work = bgr
    m = max(int(bgr.shape[0]), int(bgr.shape[1]))
    if m > _OCR_INPUT_MAX_EDGE:
        scale = _OCR_INPUT_MAX_EDGE / float(m)
        work = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    angle = _estimate_skew_angle_deg(gray)
    rotated = _rotate_bound(work, angle)
    gray_r = cv2.cvtColor(rotated, cv2.COLOR_BGR2GRAY)

    # 轻微平滑，抑制传感器噪声，再自适应二值化
    gray_r = cv2.GaussianBlur(gray_r, (3, 3), 0)
    hr, wr = gray_r.shape[:2]
    short = min(hr, wr)
    block = int(max(_ADAPT_BLOCK_MIN, min(_ADAPT_BLOCK_MAX, (short // 24) * 2 + 1)))
    if block % 2 == 0:
        block += 1
    binary = cv2.adaptiveThreshold(
        gray_r,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block,
        _ADAPT_C,
    )
    # 三通道输入，与常见 OCR 管线一致
    out = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    return out


def extract_text_lines_from_ocr_result(result) -> list:
    """
    兼容 PaddleOCR 3.x（list[dict]，含 rec_texts / rec_scores / rec_polys）
    与旧版（list[list]，每项 [box, (text, score)]）。
    """
    lines_out: list = []
    if not result:
        return lines_out

    # --- 3.x：每页一个 dict ---
    if isinstance(result, list) and result and isinstance(result[0], dict):
        for page in result:
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            polys = page.get("rec_polys") or page.get("dt_polys") or []
            for i, text in enumerate(texts):
                conf = float(scores[i]) if i < len(scores) else 0.0
                box = polys[i] if i < len(polys) else None
                if box is not None and hasattr(box, "tolist"):
                    box = box.tolist()
                lines_out.append({"text": str(text), "confidence": conf, "box": box})
        return lines_out

    # --- 旧版：[[[box, (text, conf)], ...]] 或 [None, lines] ---
    for block in result:
        if not block:
            continue
        if isinstance(block, dict):
            continue
        if not isinstance(block, (list, tuple)):
            continue
        for line in block:
            if not line or len(line) < 2:
                continue
            box, info = line[0], line[1]
            if isinstance(info, (list, tuple)) and len(info) >= 2:
                lines_out.append(
                    {
                        "text": str(info[0]),
                        "confidence": float(info[1]),
                        "box": box,
                    }
                )
            elif isinstance(info, str):
                lines_out.append({"text": info, "confidence": 1.0, "box": box})
    return lines_out


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    # 1. 快速读取图像
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="无法解码图片")

    # 2. OpenCV 预处理（自适应二值化 + 倾斜校正）后再识别
    img = preprocess_rx_image(img)

    # 3. PaddleOCR 核心识别 (耗时通常在 200-500ms)
    # 新版 PaddleOCR pipeline 的 predict 不再接受 cls= 参数
    result = ocr.ocr(img)

    # 4. 提取文本碎片（兼容 3.x / 旧版返回结构）
    raw_texts = extract_text_lines_from_ocr_result(result)

    return {
        "status": "success",
        "data": raw_texts,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8866)
