import type { VisionAnalyzeResponse, VisionImagePayload, VisionProvider } from '../types';
import { PUPIL_FRAME_SYSTEM_PROMPT } from '../prompts';
import { extractFirstJsonObject } from '../jsonExtract';
import { assertPupilFrameCoordinates } from '../validate';
import { postChatCompletions, userContentWithImage } from './openaiCompatible';

/**
 * 阿里云通义千问 VL（OpenAI 兼容模式示例）。
 *
 * 环境变量（按你控制台实际为准）：
 * - QWEN_OPENAI_BASE_URL：如 https://dashscope.aliyuncs.com/compatible-mode/v1
 * - QWEN_API_KEY
 * - QWEN_VL_MODEL：如 qwen-vl-plus
 */
export class QwenVisionProvider implements VisionProvider {
  readonly id = 'qwen' as const;

  async analyzePupilFrame(payload: VisionImagePayload): Promise<VisionAnalyzeResponse> {
    const apiKey = process.env.QWEN_API_KEY || '';
    const baseUrl =
      process.env.QWEN_OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = process.env.QWEN_VL_MODEL || '';

    if (!apiKey) throw new Error('未配置 QWEN_API_KEY');
    if (!model) throw new Error('未配置 QWEN_VL_MODEL');

    const userText = '请仅输出 JSON，坐标为相对本张图像的像素坐标。';

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
    return { provider: 'qwen', structured, rawText: content };
  }
}
