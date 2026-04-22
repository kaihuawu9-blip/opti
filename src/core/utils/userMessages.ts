export function toChineseErrorMessage(raw: unknown): string {
  const m = typeof raw === 'string' ? raw.trim() : String(raw || '');
  if (!m) return '发生未知错误，请稍后重试。';

  if (/<html[\s>]/i.test(m) && /404|not\s+found/i.test(m) && /nginx/i.test(m)) {
    return '云端接口地址配置错误：当前请求到了静态网站（Nginx 404），请将 ALIYUN_REST_URL 等接口地址改为后端 API 网关地址。';
  }
  if (/<!doctype\s+html/i.test(m)) {
    return '網關路徑配置錯誤';
  }
  if (/<html[\s>]/i.test(m) && /404|not\s+found/i.test(m)) {
    return '接口返回了 HTML 错误页（常见为 404）。请确认请求使用 `/api/...` 或 PostgREST 网关地址，并检查 NEXT_PUBLIC_API_URL / ALIYUN_REST_URL。';
  }

  if (/failed to fetch/i.test(m) || /networkerror/i.test(m) || /load failed/i.test(m)) {
    return '网络请求失败，请检查网络连接或云端服务是否已正确配置。';
  }
  if (/could not find the table/i.test(m)) {
    return '数据库中缺少所需数据表，请在云端控制台执行建表脚本。';
  }
  if (/jwt|invalid api key|api key/i.test(m)) {
    return '访问密钥无效或已过期，请检查配置文件中的密钥是否正确。';
  }
  if (/permission denied|rls|row-level security/i.test(m)) {
    return '没有操作权限，请在云端控制台检查数据访问策略。';
  }
  if (/invalid input syntax for type uuid:\s*""/i.test(m)) {
    return '会话或门店数据异常（UUID 为空）。请先重新登录，并重新选择门店后再结算。';
  }
  if (/duplicate key|unique constraint/i.test(m)) {
    return '数据重复，请检查是否已存在相同记录。';
  }

  return m;
}

export function cloudDbRlsProductsHint(): string {
  return (
    '\n\n【修复】请在 PostgreSQL（阿里云 RDS）上执行项目里的 supabase/migration_cashier_rls_fix.sql 全文（为收银等角色开放商品写入与库存扣减）。' +
    '\n或在项目根目录执行：npm run migrate:cashier-rls（需已配置与 npm run migrate:auth 相同的数据库访问方式）。'
  );
}
