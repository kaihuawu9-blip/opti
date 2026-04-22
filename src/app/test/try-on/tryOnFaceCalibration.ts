import { Matrix4 } from 'three';

/** 模型局部「镜圈左右瞳心距」近似长度（与 GlassesRig3D 几何一致） */
export const MODEL_IPD_LOCAL_UNITS = 0.72;

/** 成人瞳距参考（mm），与红色标定贴纸/测量架一致 */
export const REF_PD_MM = 63;

/** 镜架左右总宽约（mm），用于贴纸 px/mm → 世界缩放 */
export const EST_FRAME_WIDTH_MM = 136;

/**
 * 平板 ortho 像素空间 ← MediaPipe canonical 脸空间
 * 链：先应用 faceMatrix，再映射到以画面中心为原点、Y 向上的 ortho，最后乘 sticker 均匀缩放。
 */
export function composeGlassesWorldMatrixFromFaceMatrix(params: {
  faceMatrix: Matrix4;
  viewW: number;
  viewH: number;
  /** 由 2mm/1mm 标定条 + 瞳距像素混合得到的「世界」均匀缩放 */
  stickerUniformScale: number;
  /** 脸在画面中的前后（landmark z），用于轻微推拉尺度 */
  depthScale: number;
  /** 沿视线前移镜架（像素量级） */
  zLift: number;
}): Matrix4 {
  const { faceMatrix, viewW, viewH, stickerUniformScale, depthScale, zLift } = params;
  const w = Math.max(2, viewW);
  const h = Math.max(2, viewH);

  const m = new Matrix4().copy(faceMatrix);

  /** canonical / 归一化空间 → 与 ortho 相机一致的像素尺度（Y 翻转与视频一致） */
  const scaleMat = new Matrix4().makeScale(w, -h, h * 0.58 * depthScale);
  const transMat = new Matrix4().makeTranslation(-w * 0.5, h * 0.5, zLift);
  const normToOrtho = new Matrix4().multiplyMatrices(transMat, scaleMat);
  m.premultiply(normToOrtho);

  const sc = new Matrix4().makeScale(stickerUniformScale, stickerUniformScale, stickerUniformScale);
  m.multiply(sc);

  return m;
}

/**
 * 红色贴纸物理比例：pxPerMm（每毫米占多少像素，来自标定页）与当前脸瞳距像素联合，
 * 估计镜架在 ortho 空间中的真实宽度（像素），再换算为相对 MODEL_IPD_LOCAL_UNITS 的缩放。
 */
export function computeStickerUniformScale(params: {
  ipdPx: number;
  pxPerMm: number;
  viewW: number;
}): number {
  const ipd = Math.max(16, params.ipdPx);
  const pxPerMm = Math.max(1, Math.min(24, params.pxPerMm));
  const mmPerPxFace = REF_PD_MM / ipd;
  const mmPerPxTape = 1 / pxPerMm;
  const blendedMmPerPx = mmPerPxFace * 0.52 + mmPerPxTape * 0.48;
  const frameWidthPx = EST_FRAME_WIDTH_MM / Math.max(1e-6, blendedMmPerPx);
  const s = frameWidthPx / MODEL_IPD_LOCAL_UNITS;
  const cap = Math.max(0.35, Math.min(params.viewW * 0.018, s));
  return cap;
}

export function computeDepthScaleFromAvgFaceZ(avgFaceZ: number): number {
  if (!Number.isFinite(avgFaceZ)) return 1;
  return Math.max(0.78, Math.min(1.22, 1 + avgFaceZ * 2.15));
}
