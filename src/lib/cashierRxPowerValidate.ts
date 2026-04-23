import type { CartItem, RxEye } from '@/components/cashier/cashierCartTypes';
import type { ZeissPowerRange } from '@/data/zeissPriceMatrix';
import { validatePrescriptionAgainstRange, validateZeissPrescription } from '@/lib/priceListEngine';

function parseRxDiopter(s: string): number | null {
  const t = String(s ?? '')
    .trim()
    .replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function validateOneEye(
  label: string,
  eye: RxEye,
  matrixRef: CartItem['zeiss_matrix_rx_ref'],
  embeddedRange: ZeissPowerRange | null | undefined,
): string | null {
  const dsTrim = String(eye.ds ?? '').trim();
  if (!dsTrim) return null;
  const sph = parseRxDiopter(eye.ds);
  const cylRaw = parseRxDiopter(eye.dc);
  const cyl = cylRaw ?? 0;
  if (sph == null) return `${label}：球镜「${dsTrim}」无法解析为数字，请修正。`;
  if (String(eye.dc ?? '').trim() !== '' && cylRaw == null) {
    return `${label}：柱镜「${String(eye.dc).trim()}」无法解析为数字，请修正。`;
  }
  if (matrixRef) {
    const v = validateZeissPrescription(matrixRef.productName, matrixRef.index, sph, cyl);
    if (!v.ok) return `${label}：${v.reason ?? '超出价目册光度范围'}`;
    return null;
  }
  if (embeddedRange) {
    const v = validatePrescriptionAgainstRange(embeddedRange, sph, cyl);
    if (!v.ok) return `${label}：${v.reason ?? '超出光度包络'}`;
    return null;
  }
  return null;
}

/**
 * 验光单「保存」前：若本行镜片带有矩阵 ref 或手册内嵌 powerRange，则与 OD/OS 已填球柱比对。
 */
export function validateCartLineRxPowerEnvelope(item: CartItem): {
  ok: boolean;
  title: string;
  body: string;
} {
  const ref = item.zeiss_matrix_rx_ref ?? null;
  const ext = item as CartItem & { ext_handbook_power_range?: ZeissPowerRange | null };
  const embedded = ext.ext_handbook_power_range ?? null;
  if (!ref && !embedded) {
    return { ok: true, title: '', body: '' };
  }
  const msgs: string[] = [];
  const od = validateOneEye('右眼 (OD)', item.rx.right, ref, embedded);
  if (od) msgs.push(od);
  const os = validateOneEye('左眼 (OS)', item.rx.left, ref, embedded);
  if (os) msgs.push(os);
  if (!msgs.length) return { ok: true, title: '', body: '' };
  return {
    ok: false,
    title: '度数超出此款价目册范围',
    body: msgs.join('\n'),
  };
}
