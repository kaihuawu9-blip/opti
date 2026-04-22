import type { VisionAnalyzeResponse, VisionImagePayload, VisionProvider } from '../types';
import { PUPIL_FRAME_SYSTEM_PROMPT } from '../prompts';
import { extractFirstJsonObject } from '../jsonExtract';
import { assertPupilFrameCoordinates } from '../validate';
import { postChatCompletions, userContentWithImage } from './openaiCompatible';

/**
 * 火山方舟（豆包）多模态 — OpenAI 兼容接口。
 *
 * 环境变量：
 * - ARK_API_KEY：方舟 API Key（Bearer）
 * - ARK_BASE_URL：默认 https://ark.cn-beijing.volces.com/api/v3
 * - ARK_MODEL：推理接入点 ID（如 ep-xxxx）
 */
export class DoubaoVisionProvider implements VisionProvider {
  readonly id = 'doubao' as const;

  async analyzePupilFrame(payload: VisionImagePayload): Promise<VisionAnalyzeResponse> {
    const apiKey = process.env.ARK_API_KEY || '';
    const baseUrl = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
    const model = process.env.ARK_MODEL || '';

    if (!apiKey) throw new Error('未配置 ARK_API_KEY');
    if (!model) throw new Error('未配置 ARK_MODEL（方舟接入点 ID）');

    const userText =
      '请根据系统说明，仅输出 JSON。图中坐标均为相对本张输入图像的像素坐标。';

    const { content } = await postChatCompletions(baseUrl, apiKey, {
      model,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: PUPIL_FRAME_SYSTEM_PROMPT },
        {
          role: 'user',
          content: userContentWithImage(userText, payload),
        },
      ],
    });

    const parsed = extractFirstJsonObject(content);
    const structured = assertPupilFrameCoordinates(parsed);
    return {
      provider: 'doubao',
      structured,
      rawText: content,
    };
  }
}
