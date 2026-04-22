import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { CreateConcurrencyBusyError } from '@/lib/modelTask/createConcurrency';
import { getPollTierFastMs } from '@/lib/modelTask/pollConfig';
import { serializeModelTaskForApi } from '@/lib/modelTask/modelTaskSerialize';
import { linkStoreToFrameModel } from '@/lib/modelTask/storeFrameLink';
import {
  normalizeImageContentMd5,
  pollUntilComplete,
  resolveOrCreate3DModelTask,
  tryComputeMd5FromImageUrl,
} from '@/lib/modelTask/hunyuan3dTasks';
import { resolveImageUrlForHunyuan3dFetch } from '@/lib/oss/hunyuan3dOssImageUrl';
import { getAi3dModelVersion, getTencentCredentials } from '@/lib/tencent/hunyuan3dEnv';

export const runtime = 'nodejs';

/**
 * 镜架图 → 混元 3D：直连 `ai3d.tencentcloudapi.com`（TC3 签名），
 * `SubmitHunyuanTo3DProJob` 提交（ImageUrl → JobId）、`QueryHunyuanTo3DProJob` 轮询（WAIT/RUN/DONE），
 * `ModelVersion` 为 Lite/Turbo（默认 Turbo，见 TENCENT_AI3D_MODEL_VERSION）。
 * 请求体需同时提供 `imageUrl` 与 `imageContentMd5`（32 位 hex），并校验与图片内容一致。
 * 若 `imageUrl` 指向当前环境配置的阿里云 OSS 桶内对象，会先换发带 `https://` 的 GET 预签名 URL 再供腾讯云拉取（与混元侧 DownloadError 规避策略一致）。
 */
export async function POST(req: Request) {
  try {
    if (!getTencentCredentials()) {
      return NextResponse.json(
        {
          ok: false,
          error: '未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，无法调用 ai3d.tencentcloudapi.com。',
        },
        { status: 401 },
      );
    }

    const body = (await req.json()) as {
      imageUrl?: unknown;
      imageContentMd5?: unknown;
      storeId?: unknown;
    };
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
    const imageContentMd5 = typeof body.imageContentMd5 === 'string' ? body.imageContentMd5 : '';
    const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';

    if (!imageUrl) {
      return NextResponse.json({ ok: false, error: '缺少 imageUrl' }, { status: 400 });
    }

    const md5 = normalizeImageContentMd5(imageContentMd5);
    if (!md5) {
      return NextResponse.json(
        { ok: false, error: 'imageContentMd5 无效：需为 32 位小写/大写十六进制 MD5' },
        { status: 400 },
      );
    }

    const fetchUrlForMd5 = await resolveImageUrlForHunyuan3dFetch(imageUrl);
    const computed = await tryComputeMd5FromImageUrl(fetchUrlForMd5);
    if (!computed) {
      return NextResponse.json(
        { ok: false, error: '无法根据 imageUrl 拉取图片以校验 MD5（超时、非 200 或体积过大）' },
        { status: 400 },
      );
    }
    if (computed !== md5) {
      return NextResponse.json(
        { ok: false, error: 'MD5 与图片内容不一致：请确认 imageContentMd5 与当前 imageUrl 对应文件一致' },
        { status: 400 },
      );
    }

    const { row, kind } = await resolveOrCreate3DModelTask(imageUrl, { imageContentMd5: md5 });

    if (storeId) {
      try {
        await linkStoreToFrameModel(storeId, row.contentMd5);
      } catch (linkErr) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        return NextResponse.json({ ok: false, error: `门店关联失败：${msg}` }, { status: 400 });
      }
    }

    if (kind !== 'CACHE_SUCCESS') {
      after(() => {
        void pollUntilComplete(row.taskId);
      });
    }

    return NextResponse.json({
      ok: true,
      data: serializeModelTaskForApi(row),
      meta: {
        source: kind,
        modelReady: kind === 'CACHE_SUCCESS',
        joinPending: kind === 'JOIN_PENDING',
        endpoint: 'https://ai3d.tencentcloudapi.com',
        modelVersion: getAi3dModelVersion(),
        pollIntervalMs: getPollTierFastMs(),
      },
    });
  } catch (e) {
    if (e instanceof CreateConcurrencyBusyError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 429 });
    }
    const message = e instanceof Error ? e.message : '生成 3D 失败';
    if (message.includes('不能为空') || message.includes('无法确定图片') || message.includes('MD5')) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    const lower = message.toLowerCase();
    if (lower.includes('authfailure') || lower.includes('签名过期') || lower.includes('secretidnotfound')) {
      return NextResponse.json({ ok: false, error: message }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
