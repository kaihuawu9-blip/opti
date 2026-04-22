import pkg from '../../package.json';

/** 与仓库根目录 package.json 的 version 一致，随构建打入前端，避免 .env 固定成 1.0.0 */
export const APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
