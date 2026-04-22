'use client';

/** 与收银台 CartItem 兼容的最小形状（避免从 page 循环引用类型） */
export type RxPrintItem = {
  name: string;
  category?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  rx: {
    right: { ds: string; dc: string; axis: string; va: string; pd: string; add?: string };
    left: { ds: string; dc: string; axis: string; va: string; pd: string; add?: string };
  };
};

// 与收银台 isLensProduct 逻辑一致
const QUICK = '快充';

function isLensProductItem(item: RxPrintItem): boolean {
  if ((item.category || '').trim() === QUICK) return false;
  if ((item.category || '').trim() === '套餐') return true;
  if ((item.category || '').trim() === '自主配镜') return true;
  return (
    Boolean(item.lens_type) ||
    (item.category || '').includes('镜片') ||
    item.name.toLowerCase().includes('镜片')
  );
}

function cell(v: string) {
  const t = String(v || '').trim();
  return t || '—';
}

/** 轴位小票上不强制带 °，与常见验光单一致 */
function axisCell(v: string) {
  const t = String(v || '').trim().replace(/°+$/u, '');
  return t || '—';
}

type Props = { item: RxPrintItem };

/**
 * 收据/加工单：镜框镜片说明 + 标准验光表（黑线表格）
 */
export function RxPrintBlock({ item }: Props) {
  const frame = item.frame_type?.trim();
  const lens = item.lens_type?.trim();
  const header = [frame && `镜框:${frame}`, lens && `镜片:${lens}`].filter(Boolean).join(' · ');
  const r = item.rx.right;
  const l = item.rx.left;
  const addR = cell(r.add ?? '');
  const addL = cell(l.add ?? '');

  if (!isLensProductItem(item)) {
    if (!header) return null;
    return <p className="rx-print-meta">{header}</p>;
  }

  return (
    <div className="rx-print-block">
      {header ? <p className="rx-print-meta">{header}</p> : null}
      <table className="rx-print-rxgrid">
        <thead>
          <tr>
            <th scope="col">眼睛</th>
            <th scope="col">球镜 (SPH)</th>
            <th scope="col">散光 (CYL)</th>
            <th scope="col">轴位 (AX)</th>
            <th scope="col">下加 (ADD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">右 (OD)</th>
            <td>{cell(r.ds)}</td>
            <td>{cell(r.dc)}</td>
            <td>{axisCell(r.axis)}</td>
            <td>{addR}</td>
          </tr>
          <tr>
            <th scope="row">左 (OS)</th>
            <td>{cell(l.ds)}</td>
            <td>{cell(l.dc)}</td>
            <td>{axisCell(l.axis)}</td>
            <td>{addL}</td>
          </tr>
        </tbody>
      </table>
      <p className="rx-print-va-pd">
        矫正视力 VA：OD {cell(r.va)}　OS {cell(l.va)}
        <br />
        瞳距 PD：OD {r.pd.trim() ? `${r.pd.trim()}mm` : '—'}　OS {l.pd.trim() ? `${l.pd.trim()}mm` : '—'}
      </p>
    </div>
  );
}
