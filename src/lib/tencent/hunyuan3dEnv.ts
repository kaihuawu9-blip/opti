import 'server-only';

export function getTencentCredentials(): { secretId: string; secretKey: string } | null {
  const secretId = (process.env.TENCENT_SECRET_ID || '').trim();
  const secretKey = (process.env.TENCENT_SECRET_KEY || '').trim();
  if (!secretId || !secretKey) {
    return null;
  }
  return { secretId, secretKey };
}

export function getTencentRegion(): string {
  return (process.env.TENCENT_REGION || 'ap-guangzhou').trim() || 'ap-guangzhou';
}

/** 创建任务 Action：默认 SubmitHunyuanTo3DProJob（ai3d.tencentcloudapi.com）；可改为 CreateHunyuan3DTask 等。 */
export function getCreate3DAction(): string {
  return (process.env.TENCENT_AI3D_CREATE_ACTION || 'SubmitHunyuanTo3DProJob').trim() || 'SubmitHunyuanTo3DProJob';
}

/** 查询任务 Action：默认 QueryHunyuanTo3DProJob（按 JobId 轮询 WAIT/RUN/DONE）；可改为 DescribeHunyuan3DTask。 */
export function getDescribe3DAction(): string {
  return (process.env.TENCENT_AI3D_QUERY_ACTION || 'QueryHunyuanTo3DProJob').trim() || 'QueryHunyuanTo3DProJob';
}

/** SubmitHunyuanTo3DProJob / CreateHunyuan3DTask 等接口的 ModelVersion：`Lite` | `Turbo`，默认 Turbo（门店极速）。 */
export function getAi3dModelVersion(): 'Lite' | 'Turbo' {
  const v = (process.env.TENCENT_AI3D_MODEL_VERSION || 'Turbo').trim();
  if (v === 'Lite' || v === 'Turbo') return v;
  return 'Turbo';
}
