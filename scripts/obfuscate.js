#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 为 Electron 生成 out/ 静态资源（与 main.js 中 app:// 协议一致）。
 * output: export 与 App Router 下的 API route 不兼容，故导出前暂存 src/app/api，结束后再移回。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const appApi = path.join(root, 'src', 'app', 'api');
const stashRoot = path.join(root, '.electron-export-stash');
const stashApi = path.join(stashRoot, 'api');

function run(label, command, env = {}) {
  console.error(`\n[obfuscate] ${label}…\n`);
  const r = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\n[obfuscate] 失败：${label}（退出码 ${r.status ?? 'unknown'}）\n`);
    process.exit(r.status ?? 1);
  }
}

let stashed = false;

try {
  if (fs.existsSync(appApi)) {
    fs.mkdirSync(stashRoot, { recursive: true });
    if (fs.existsSync(stashApi)) {
      fs.rmSync(stashApi, { recursive: true, force: true });
    }
    fs.renameSync(appApi, stashApi);
    stashed = true;
    console.error('[obfuscate] 已暂存 src/app/api → .electron-export-stash/api');
  } else {
    console.error('[obfuscate] 未找到 src/app/api，按当前树直接静态导出');
  }

  run('Next.js static export (out/)', 'npx next build --webpack', { ELECTRON_STATIC_EXPORT: '1' });

  const outIndex = path.join(root, 'out', 'index.html');
  if (!fs.existsSync(outIndex)) {
    console.error('[obfuscate] 未生成 out/index.html，请检查 Next 配置与构建日志');
    process.exit(1);
  }
  console.error(`\n[obfuscate] 完成：${path.join(root, 'out')}\n`);
} finally {
  if (stashed && fs.existsSync(stashApi)) {
    if (fs.existsSync(appApi)) {
      fs.rmSync(appApi, { recursive: true, force: true });
    }
    fs.renameSync(stashApi, appApi);
    console.error('[obfuscate] 已恢复 src/app/api');
  }
}
