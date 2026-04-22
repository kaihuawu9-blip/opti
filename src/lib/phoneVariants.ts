/** 与收银台登记手机号比对时可能用到的几种写法（不含空格横杠变体，建议在收银台统一 11 位数字） */
export function customerPhoneSearchVariants(digits11: string): string[] {
  const d = digits11.replace(/\D/g, '');
  const core = d.length >= 11 ? d.slice(-11) : d;
  if (core.length !== 11) return [digits11.trim()].filter(Boolean);
  const out = new Set<string>();
  out.add(core);
  out.add(`+86${core}`);
  out.add(`86${core}`);
  return [...out];
}

export function maskPhoneMiddle(phoneDigits: string): string {
  const d = phoneDigits.replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}
