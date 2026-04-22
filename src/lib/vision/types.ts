/**
 * 视觉服务：与具体云厂商解耦，仅约定「压缩图 + 多模态对话 → 结构化坐标」。
 */

export type VisionProviderId = 'doubao' | 'qwen' | 'deepseek';

/** AI 返回的像素坐标（与上传给模型的那张图一致，原点在左上角，x 向右、y 向下） */
export type PupilFrameCoordinates = {
  left_pupil_x: number;
  left_pupil_y: number;
  right_pupil_x: number;
  right_pupil_y: number;
  /** 镜框/测量架下沿在图中的 y（或模板水平参考线），用于瞳高换算 */
  frame_bottom_y: number;
  /** 0–1，可选 */
  confidence?: number;
  /** 模型附加说明 */
  notes?: string;
};

export type VisionImagePayload = {
  /** data:image/jpeg;base64,... */
  dataUrl: string;
  base64: string;
  mimeType: string;
};

export type VisionAnalyzeResponse = {
  provider: VisionProviderId;
  structured: PupilFrameCoordinates;
  /** 模型原始文本，便于排错 */
  rawText?: string;
};

export interface VisionProvider {
  readonly id: VisionProviderId;
  analyzePupilFrame(payload: VisionImagePayload): Promise<VisionAnalyzeResponse>;
}

export type PreprocessOptions = {
  /** 长边上限（像素） */
  maxEdge?: number;
  /** JPEG 质量 1–100 */
  quality?: number;
};
