'use client';

import { createContext, useContext } from 'react';
import type { Matrix4 } from 'three';

export type TryOnR3fPose = {
  w: number;
  h: number;
  cx: number;
  cy: number;
  yaw: number;
  pitch: number;
  roll: number;
  ipdPx: number;
  hasFace: boolean;
  /** MediaPipe 4×4，canonical → 检测脸；与 landmarks 同步更新 */
  faceMatrix: Matrix4 | null;
  /** 左右眼 iris 参考点 z 均值（归一化深度），用于离屏远近微调 */
  avgFaceZ: number;
  /** 测量架 / 红色贴纸标定：像素每毫米（px/mm） */
  pxPerMm: number;
};

export const TryOnPoseBridgeContext = createContext<{
  poseRef: React.MutableRefObject<TryOnR3fPose | null>;
} | null>(null);

export function useTryOnPoseBridge() {
  const ctx = useContext(TryOnPoseBridgeContext);
  if (!ctx) throw new Error('TryOnPoseBridgeContext missing');
  return ctx;
}
