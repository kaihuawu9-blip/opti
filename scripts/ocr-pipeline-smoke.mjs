#!/usr/bin/env node
/**
 * OCR 链路冒烟：① 直连 Paddle /predict ②（可选）Next /api/vision/rx-from-text
 *
 * 用法：
 *   1) 先启动 Paddle：`docker run --rm -p 8866:8866 ocr-service:latest`（或已有容器映射 8866）
 *   2) 仅测 Paddle：`node scripts/ocr-pipeline-smoke.mjs`
 *   3) 连测 AI 蒸馏：先 `npm run dev`，再 `set NEXT_TEST=1&& node scripts/ocr-pipeline-smoke.mjs`
 *
 * 环境变量：
 *   PADDLE_URL   默认 http://127.0.0.1:8866
 *   NEXT_URL     默认 http://127.0.0.1:8080（仅 NEXT_TEST=1 时请求）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const paddleBase = (process.env.PADDLE_URL || 'http://127.0.0.1:8866').replace(/\/$/, '');
const nextBase = (process.env.NEXT_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const runNext = process.env.NEXT_TEST === '1' || process.env.NEXT_TEST === 'true';

/** 稳定可访问的小图（JPEG） */
const SAMPLE_JPEG_URL = 'https://picsum.photos/id/237/320/240.jpg';

async function ensureSampleImage(tmpPath) {
  if (process.env.TEST_IMAGE && fs.existsSync(process.env.TEST_IMAGE)) {
    fs.copyFileSync(process.env.TEST_IMAGE, tmpPath);
    return;
  }
  const r = await fetch(SAMPLE_JPEG_URL);
  if (!r.ok) throw new Error(`无法下载测试图 ${SAMPLE_JPEG_URL} HTTP ${r.status}`);
  fs.writeFileSync(tmpPath, Buffer.from(await r.arrayBuffer()));
}

async function paddlePredict(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const body = new FormData();
  const ext = imagePath.endsWith('.png') ? 'png' : 'jpg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  body.append('file', new Blob([buf], { type: mime }), `smoke.${ext}`);
  const url = `${paddleBase}/predict`;
  const resp = await fetch(url, { method: 'POST', body });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Paddle 返回非 JSON（HTTP ${resp.status}）：${text.slice(0, 400)}`);
  }
  if (!resp.ok) {
    throw new Error(`Paddle HTTP ${resp.status}: ${text.slice(0, 400)}`);
  }
  if (json.status !== 'success' || !Array.isArray(json.data)) {
    throw new Error(`Paddle 结构异常: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

async function nextRxFromText(rawText) {
  const resp = await fetch(`${nextBase}/api/vision/rx-from-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawText:
        rawText.trim() ||
        '右眼 S -5.00 C -1.00 A 90 左眼 S -4.50 C -0.75 A 85',
    }),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Next 返回非 JSON（HTTP ${resp.status}）：${text.slice(0, 400)}`);
  }
  if (!resp.ok || !json.ok) {
    throw new Error(`rx-from-text 失败 HTTP ${resp.status}: ${json.error || text.slice(0, 400)}`);
  }
  return json;
}

async function main() {
  const tmp = path.join(os.tmpdir(), `ocr-smoke-${Date.now()}.jpg`);
  await ensureSampleImage(tmp);
  console.log('[smoke] 测试图:', tmp, 'bytes=', fs.statSync(tmp).size);

  console.log('[1/2] POST', `${paddleBase}/predict`);
  const paddleJson = await paddlePredict(tmp);
  const rawText = paddleJson.data.map((x) => x.text).join(' ');
  console.log('[1/2] OK  status=', paddleJson.status, ' lines=', paddleJson.data.length, ' rawText.len=', rawText.length);

  if (runNext) {
    console.log('[2/2] POST', `${nextBase}/api/vision/rx-from-text (NEXT_TEST=1)`);
    const aiJson = await nextRxFromText(rawText);
    console.log('[2/2] OK  result.right.ds=', aiJson.result?.right?.ds, ' left.ds=', aiJson.result?.left?.ds);
  } else {
    console.log('[2/2] 跳过（未设 NEXT_TEST=1）。要测豆包蒸馏请先 npm run dev，再：');
    console.log('      set NEXT_TEST=1&& node scripts/ocr-pipeline-smoke.mjs');
  }

  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  console.log('[smoke] 全部通过');
}

main().catch((e) => {
  console.error('[smoke] 失败:', e.message || e);
  if (String(e.message || '').includes('fetch failed') || e.cause) {
    console.error('       若测 Paddle：请确认本机 8866 已监听（docker run -p 8866:8866 ocr-service）');
  }
  process.exit(1);
});
