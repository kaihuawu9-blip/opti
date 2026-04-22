#!/usr/bin/env node
/**
 * 跨平台：obfuscate（内含 next export → out/）→ electron-builder --win dir
 * 原 Windows 专用命令可用 npm run dist:win-cmd
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};

function run(label, command) {
  console.error(`\n[dist] ${label}…\n`);
  const r = spawnSync(command, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) {
    console.error(`\n[dist] 失败：${label}（退出码 ${r.status ?? 'unknown'}）\n`);
    process.exit(r.status ?? 1);
  }
}

run('静态导出到 out/（scripts/obfuscate.js）', 'node scripts/obfuscate.js');
run('electron-builder (Windows dir)', 'npx electron-builder --win dir');

console.error('\n[dist] 完成。输出目录见 package.json → build.directories.output（默认 dist/）\n');
