#!/usr/bin/env node
/**
 * 验证 OPENAI_API_KEY / OPENAI_BASE_URL 是否可用（请求 /v1/models?limit=1）。
 * 用法（在项目根目录）：
 *   node scripts/test-openai-key.mjs
 * 不依赖额外 npm 包；会读取项目根 `.env` 覆盖同名环境变量。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnvLocal() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) {
    console.error('未找到 .env（请在项目根目录运行）');
    return;
  }
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvLocal();

const key = (process.env.OPENAI_API_KEY || '').trim();
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

if (!key) {
  console.error('失败：.env 中未设置 OPENAI_API_KEY');
  process.exit(1);
}

const url = `${base}/models?limit=1`;
try {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (res.ok) {
    console.log('成功：HTTP', res.status, '→ API Key 与 BASE_URL 可用');
    try {
      const j = JSON.parse(text);
      const first = j?.data?.[0]?.id;
      if (first) console.log('示例模型:', first);
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
  console.error('失败：HTTP', res.status);
  console.error(text.slice(0, 400));
  process.exit(1);
} catch (e) {
  console.error('失败：网络错误', e instanceof Error ? e.message : e);
  process.exit(1);
}
