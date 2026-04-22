export * from './cloudRest';

/**
 * 显式关闭鉴权：仅当值为 false / 0 / off / no（不区分大小写）时视为显式关。
 * 未设置、空串等 **不** 视为显式关。
 */
function isExplicitlyDisabledAuth(v: string | undefined): boolean {
  const n = String(v ?? '')
    .trim()
    .toLowerCase();
  return n === 'false' || n === '0' || n === 'off' || n === 'no';
}

const isDev = process.env.NODE_ENV === 'development';

/**
 * 免登录仅允许：**仅开发环境** 且环境变量显式将 `NEXT_PUBLIC_ENABLE_AUTH` 置为关。
 * 生产环境一律要求鉴权（不因缺省或误配而免登录）。
 */
const disableAuthInCurrentEnv = isDev && isExplicitlyDisabledAuth(process.env.NEXT_PUBLIC_ENABLE_AUTH);

/** 与历史命名兼容：为 true 时表示当前环境走「免登录 / 内测」分支 */
export const disableAuthMode = disableAuthInCurrentEnv;
export { disableAuthInCurrentEnv };

/** 为 true 时应走正常登录与 `/api/local-auth` 流程 */
export const authRequiredInCurrentEnv = !disableAuthInCurrentEnv;
