/**
 * 从模型输出中抽出 JSON（支持裸 JSON 或 ```json 代码块）。
 */
export function extractFirstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/im.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('响应中未找到 JSON 对象');
  }
  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice) as unknown;
}
