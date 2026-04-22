import type { VisionAnalyzeResponse, VisionImagePayload, VisionProvider } from '../types';
import { PUPIL_FRAME_SYSTEM_PROMPT } from '../prompts';
import { extractFirstJsonObject } from '../jsonExtract';
import { assertPupilFrameCoordinates } from '../validate';
import { postChatCompletions, userContentWithImage } from './openaiCompatible';

/**
 * DeepSeek 若提供 OpenAI 兼容多模态端点，可在此配置切换。
 * 若当前模型不支持图像，请在工厂中改选其它 provider。
 *
 * - DEEPSEEK_API_KEY
 * - DEEPSEEK_OPENAI_BASE_URL：如 https://api.deepseek.com/v1
 * - DEEPSEEK_VL_MODEL
 */
export class DeepSeekVisionProvider implements VisionProvider {
  readonly id = 'deepseek' as const;

  async analyzePupilFrame(payload: VisionImagePayload): Promise<VisionAnalyzeResponse> {
    const apiKey = process.env.DEEPSEEK_API_KEY || '';
    const baseUrl = process.env.DEEPSEEK_OPENAI_BASE_URL || 'https://api.deepseek.com/v1';
    const model = process.env.DEEPSEEK_VL_MODEL || '';

    if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
    if (!model) throw new Error('未配置 DEEPSEEK_VL_MODEL');

    const userText = '请仅输出 JSON。';

    const { content } = await postChatCompletions(baseUrl, apiKey, {
      model,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: PUPIL_FRAME_SYSTEM_PROMPT },
        { role: 'user', content: userContentWithImage(userText, payload) },
      ],
    });

    const parsed = extractFirstJsonObject(content);
    const structured = assertPupilFrameCoordinates(parsed);
    return { provider: 'deepseek', structured, rawText: content };
  }
}
