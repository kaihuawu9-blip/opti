import type { PupilFrameCoordinates } from './types';

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function assertPupilFrameCoordinates(data: unknown): PupilFrameCoordinates {
  if (!data || typeof data !== 'object') {
    throw new Error('结构化结果不是对象');
  }
  const o = data as Record<string, unknown>;
  const left_pupil_x = num(o.left_pupil_x);
  const left_pupil_y = num(o.left_pupil_y);
  const right_pupil_x = num(o.right_pupil_x);
  const right_pupil_y = num(o.right_pupil_y);
  const frame_bottom_y = num(o.frame_bottom_y);

  if (
    left_pupil_x === null ||
    left_pupil_y === null ||
    right_pupil_x === null ||
    right_pupil_y === null ||
    frame_bottom_y === null
  ) {
    throw new Error('缺少或非法的坐标字段');
  }

  const confidence = o.confidence !== undefined ? num(o.confidence) : undefined;
  const notes = typeof o.notes === 'string' ? o.notes : undefined;

  return {
    left_pupil_x,
    left_pupil_y,
    right_pupil_x,
    right_pupil_y,
    frame_bottom_y,
    ...(confidence !== null && confidence !== undefined ? { confidence } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}
