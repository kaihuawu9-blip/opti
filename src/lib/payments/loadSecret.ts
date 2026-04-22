import fs from 'fs';
import path from 'path';

/**
 * 从环境变量读取 PEM：优先 `*_PATH` 读文件，否则 `*` 原文（支持把换行写成 \\n）。
 * 禁止在代码中写死私钥。
 */
export function loadSecretFromEnv(name: string, pathSuffix = '_PATH'): Buffer {
  const pathKey = `${name}${pathSuffix}`;
  const filePath = process.env[pathKey]?.trim();
  if (filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    return fs.readFileSync(resolved);
  }
  const inline = process.env[name]?.trim();
  if (!inline) {
    throw new Error(`缺少环境变量 ${name} 或 ${pathKey}`);
  }
  const normalized = inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  return Buffer.from(normalized, 'utf8');
}

export function loadOptionalSecretFromEnv(name: string, pathSuffix = '_PATH'): Buffer | null {
  const pathKey = `${name}${pathSuffix}`;
  if (!process.env[name]?.trim() && !process.env[pathKey]?.trim()) return null;
  return loadSecretFromEnv(name, pathSuffix);
}
