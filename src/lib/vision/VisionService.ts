import type { PreprocessOptions, VisionAnalyzeResponse, VisionProvider, VisionProviderId } from './types';
import { preprocessTabletPhotoForVision } from './imagePreprocess';
import { DoubaoVisionProvider } from './providers/doubao';
import { QwenVisionProvider } from './providers/qwen';
import { DeepSeekVisionProvider } from './providers/deepseek';

function providerFromId(id: VisionProviderId): VisionProvider {
  switch (id) {
    case 'doubao':
      return new DoubaoVisionProvider();
    case 'qwen':
      return new QwenVisionProvider();
    case 'deepseek':
      return new DeepSeekVisionProvider();
    default: {
      const _exhaustive: never = id;
      throw new Error(`未知 VISION_PROVIDER: ${_exhaustive}`);
    }
  }
}

/**
 * 视觉分析入口：压缩图 → Base64 → 多模态模型 → 结构化像素坐标。
 * 毫米换算请在业务层用测量架刻度（mm/px）对 structured 坐标自行计算。
 */
export class VisionService {
  constructor(private readonly provider: VisionProvider) {}

  /** 从环境变量 VISION_PROVIDER 创建（默认 doubao） */
  static fromEnv(): VisionService {
    const raw = (process.env.VISION_PROVIDER || 'doubao').toLowerCase();
    if (raw !== 'doubao' && raw !== 'qwen' && raw !== 'deepseek') {
      throw new Error(`VISION_PROVIDER 必须是 doubao | qwen | deepseek，当前: ${raw}`);
    }
    return new VisionService(providerFromId(raw as VisionProviderId));
  }

  static create(providerId: VisionProviderId): VisionService {
    return new VisionService(providerFromId(providerId));
  }

  get providerId(): VisionProviderId {
    return this.provider.id;
  }

  /**
   * @param image 原始照片（平板拍摄的原图 Buffer）
   * @param preprocess 压缩参数；物理换算不在此处理
   */
  async analyzePupilFromPhoto(
    image: Buffer,
    preprocess: PreprocessOptions = {},
  ): Promise<VisionAnalyzeResponse> {
    const payload = await preprocessTabletPhotoForVision(image, preprocess);
    return this.provider.analyzePupilFrame(payload);
  }

  /** 已自行预处理时使用 */
  async analyzePupilFromPreprocessed(payload: Awaited<ReturnType<typeof preprocessTabletPhotoForVision>>) {
    return this.provider.analyzePupilFrame(payload);
  }
}
