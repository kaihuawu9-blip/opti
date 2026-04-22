import { NextResponse } from 'next/server';

/**
 * 试戴（/test/try-on）：Canvas / 3D / 镜片染色等均在浏览器完成。
 * 本路由不做任何图像解码或像素处理，仅返回能力说明，便于运维与客户端探测。
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    policy: 'client_side_rendering_only',
    imageProcessing: false,
    description:
      '试戴 UI 与滤镜、变换、实时染色锁定在客户端；正式验配云端单次校准请使用 POST /api/measure/calibrate mode=formal_ai_refine。平板可先 POST /api/try-on/upload-frame 转存 OSS，再用返回的 sameOriginReadUrl 或 GET /api/try-on/oss-read 同源拉图后抠图（支持私有桶）。',
    measure: {
      physical: 'POST /api/measure/calibrate { mode: "physical", structured, pxPerMm }',
      formalAiRefine:
        'POST /api/measure/calibrate { mode: "formal_ai_refine", imageBase64|dataUrl, pxPerMm?, maxEdge?: 3840 }',
    },
  });
}
