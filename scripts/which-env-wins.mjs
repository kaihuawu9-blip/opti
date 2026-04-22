#!/usr/bin/env node
/**
 * 在「项目根目录」执行，读取项目根唯一环境文件 `.env`，
 * 判断各变量是否在该文件中定义（不打印变量值）。
 *
 *   cd /root/sale-system   # 或你的 ~/sale-system
 *   node scripts/which-env-wins.mjs
 *
 * 本项目约定：仅使用根目录 `.env` 作为唯一真相源。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CHAIN = ['.env'];
const WATCH_KEYS = (process.argv.slice(2).length ? process.argv.slice(2) : [
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'DATABASE_URL',
]).map((k) => k.trim()).filter(Boolean);

/** 记录每个 key 最后一次被哪个文件定义 */
const lastFile = Object.create(null);

for (const name of CHAIN) {
  const p = join(ROOT, name);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) lastFile[m[1]] = name;
  }
}

console.log(`项目根: ${ROOT}\n`);
console.log('环境文件链（本项目仅 .env）：');
CHAIN.forEach((f, i) => {
  const ok = existsSync(join(ROOT, f));
  console.log(`  ${i + 1}. ${f} ${ok ? '（存在）' : '（不存在）'}`);
});

console.log('\n下列变量定义所在文件（未列出 = 未在 .env 中定义）:');
for (const k of WATCH_KEYS) {
  const src = lastFile[k];
  console.log(`  ${k.padEnd(28)} ${src ? `→ ${src}` : '→ （未找到）'}`);
}

// 若标准名未找到，提示是否有「写错名字」或带空格键名等（不打印等号后的内容）
let tencentHints = 0;
for (const name of CHAIN) {
  const p = join(ROOT, name);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  const suspicious = lines.filter((line) => {
    const t = line.trim();
    return t && !t.startsWith('#') && /tencent/i.test(t) && !/^\s*(?:export\s+)?(?:TENCENT_SECRET_ID|TENCENT_SECRET_KEY)\s*=/.test(t);
  });
  if (suspicious.length) {
    tencentHints += suspicious.length;
    console.log(`\n${name} 中有 ${suspicious.length} 行含 “tencent” 但键名不是 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（请用编辑器打开核对，勿把密钥贴到聊天）`);
  }
}
if (!lastFile.TENCENT_SECRET_KEY && !lastFile.TENCENT_SECRET_ID && !tencentHints) {
  console.log(
    '\n说明: .env 中未出现 TENCENT_SECRET_*。混元代码读的是 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY（见 hunyuan3dEnv.ts），请在 .env 写入，例如:',
  );
  console.log('  TENCENT_SECRET_ID=你的SecretId');
  console.log('  TENCENT_SECRET_KEY=你的SecretKey');
  console.log('写完后执行: pm2 restart opti-ai --update-env');
}

// PM2 配置里的 cwd（仅作对照，不执行 pm2）
const eco = join(ROOT, 'ecosystem.config.cjs');
if (existsSync(eco)) {
  const raw = readFileSync(eco, 'utf8');
  const m = raw.match(/cwd\s*:\s*["']([^"']+)["']/);
  if (m) {
    const pm2Cwd = m[1];
    const same = pm2Cwd === ROOT || pm2Cwd === join(ROOT); // 粗略相等
    console.log(`\necosystem.config.cjs 中 PM2 cwd: ${pm2Cwd}`);
    console.log(
      same
        ? '与当前工作目录一致（或需你自行核对是否为同一真实路径）。'
        : `⚠ 与当前工作目录「${ROOT}」字符串不一致：请确认 PM2 实际启动目录与你在改的目录是否为同一套代码。`,
    );
  }
}

console.log('\n提示: 若需区分开发/生产，请在本机或部署平台用不同内容覆盖同一套变量名。');
