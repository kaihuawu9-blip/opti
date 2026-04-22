import type { PupilFrameCoordinates } from './types';

export type ScaleFromCalibration = {
  /** 每像素多少毫米（与 VisionService 返回的像素坐标相乘得到 mm） */
  mmPerPx: number;
  /** 每毫米多少像素 */
  pxPerMm: number;
};

/**
 * 用测量架上已知长度 L_mm 的线段在图上的像素长度，求比例尺。
 * 通常与人工标定或另一条视觉管线得到的 refPx 一致。
 */
export function scaleFromReferenceSegment(L_mm: number, refPx: number): ScaleFromCalibration {
  if (!(L_mm > 0) || !(refPx > 0)) {
    throw new Error('标定长度与像素长度须为正数');
  }
  const mmPerPx = L_mm / refPx;
  return { mmPerPx, pxPerMm: 1 / mmPerPx };
}

export type PhysicalPupilMeasures = {
  /** 瞳距（毫米），由左右瞳孔水平距离换算 */
  pd_mm: number;
  /** 左眼瞳高：瞳孔到镜框下沿 */
  ph_left_mm: number;
  ph_right_mm: number;
};

/**
 * 在已有 mm/px 标定下，将模型输出的像素坐标换成物理量（毫米）。
 * PD 取左右瞳孔欧氏距离在水平方向的近似：若需严格水平距，可改为仅 x 差。
 */
export function toPhysicalMeasures(
  px: PupilFrameCoordinates,
  scale: ScaleFromCalibration,
): PhysicalPupilMeasures {
  const { mmPerPx } = scale;
  const pdPx = Math.hypot(px.right_pupil_x - px.left_pupil_x, px.right_pupil_y - px.left_pupil_y);
  const pd_mm = pdPx * mmPerPx;

  const phLeftPx = Math.abs(px.frame_bottom_y - px.left_pupil_y);
  const phRightPx = Math.abs(px.frame_bottom_y - px.right_pupil_y);

  return {
    pd_mm,
    ph_left_mm: phLeftPx * mmPerPx,
    ph_right_mm: phRightPx * mmPerPx,
  };
}
