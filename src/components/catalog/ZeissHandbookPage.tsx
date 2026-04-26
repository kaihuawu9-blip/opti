'use client';

import { forwardRef, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * 透明感应层（Invisible Hit Layer）：作为 Page 的 `absolute` 子元素，**不绘制任何可见像素**。
 *
 * StandardEye「物理锚点页」— **L 形 / 异形 clip-path**（非矩形 crop）：
 * - 沿出血内侧（`anchorPreservationInsetPct`）走矩形裁切，在 **标签垂直区间** 向纸缘（0% / 100%）外折，
 *   越过标签后再回到内侧垂直红线 → 切掉标签下方「红线外」白条，凸标呈 **纸缘孤立块**，而非拖一条白边。
 * - 使用 `clip-path: polygon(...)`；无 `physicalTabHit` 时回退为 `inset(...)`。
 * - 根容器 `overflow-visible`；锚点页根背景透明，便于裁掉区域透出 3D 场景。
 * - 非锚点页：整图 `object-cover`，无 clip-path。
 * - **豪雅 `isManualTrimmed`**：页内仅整图 `object-contain`；物理 rail 由父级以 **children** 传入
 *   {@link ZeissSeriesNavList}，且仅 **PageFlip 0-based 右页**（`pageIndex % 2 !== 0 || pageIndex === 0`）挂载，与页同翻。
 */
export type ZeissHandbookPhysicalTabHit = {
  vOffsetPercent: number;
  hOffsetPercent?: number;
  side?: 'right' | 'left';
  active?: boolean;
  ariaLabel: string;
  onSelect: () => void;
  activeHighlightColor?: string;
  tooltipLabel?: string;
  physicalTabLabel?: string;
};

export type AnchorPreservationInsetPct = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ZeissHandbookPageProps = {
  title: string;
  imageData: string | null;
  imageUrl?: string | null;
  pageNumber: number;
  /** StPageFlip 子页 0-based；与父级「仅右页挂 rail」门控一致，供调试 / 可及性 */
  pageIndex?: number;
  /** 页内叠层（如 {@link ZeissSeriesNavList}），须由父级按 `pageIndex` 门控后传入 */
  children?: ReactNode;
  physicalTabHit?: ZeissHandbookPhysicalTabHit | null;
  /** 与 `getPageData().physicalAnchorPage` 一致：有凸起标签的 PDF 页 */
  physicalAnchorPage?: boolean;
  /** 覆盖默认保护性 inset（%）；通常留空，由标签左右自动选默认 */
  anchorPreservationInsetPct?: AnchorPreservationInsetPct | null;
  /**
   * 豪雅 Boss 精修页：图在 `public/catalog/hoya/pages`（URL `/catalog/hoya/pages/…`），**禁止** clip-path / inset / object-cover 二次处理；
   * 根与内层 `overflow-visible`，凸标随 3D 页运动溢出槽位。
   */
  isManualTrimmed?: boolean;
};

const PAPER_STACK_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.12), inset -2px 0 0 rgba(255,255,255,0.92), inset -5px 0 0 rgba(248,250,252,0.88), inset -9px 0 0 rgba(241,245,249,0.82), inset -13px 0 0 rgba(226,232,240,0.55), inset -16px 0 0 rgba(203,213,225,0.35)';

/** 右缘凸标：右侧 inset 极小，保留标签「伸出」成品矩形 */
const DEFAULT_INSET_RIGHT_TAB: AnchorPreservationInsetPct = {
  top: 5,
  right: 0.42,
  bottom: 5,
  left: 5.5,
};
/** 左缘凸标（翻过去后）：左侧 inset 极小 */
const DEFAULT_INSET_LEFT_TAB: AnchorPreservationInsetPct = {
  top: 5,
  right: 5.5,
  bottom: 5,
  left: 0.42,
};

const HIT_STRIP_H = 56;
const HIT_STRIP_OVERFLOW_OUT = 28;
const HIT_STRIP_INWARD_PCT = 16;

/** 标签色块在 polygon 中折返用的半高（% of 页高），与印刷凸标视觉高度同量级 */
const TAB_NOTCH_HALF_HEIGHT_PCT = 3.85;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * L 形蒙版：内侧矩形 + 纸缘一侧仅保留 [vp±half] 竖条的「凸起」；其余外侧（尤其标签下白条）不在多边形内 → 透明。
 */
function buildAnchorLShapeClipPath(
  inset: AnchorPreservationInsetPct,
  side: 'right' | 'left',
  vOffsetPercent: number,
): string {
  const L = inset.left;
  const R = inset.right;
  const T = inset.top;
  const B = inset.bottom;
  const y0 = T;
  const y1 = 100 - B;
  const vp = clamp(vOffsetPercent, y0 + TAB_NOTCH_HALF_HEIGHT_PCT + 0.2, y1 - TAB_NOTCH_HALF_HEIGHT_PCT - 0.2);
  const half = TAB_NOTCH_HALF_HEIGHT_PCT;
  const yTabTop = clamp(vp - half, y0 + 0.1, y1 - 0.1);
  const yTabBot = clamp(vp + half, y0 + 0.1, y1 - 0.1);

  if (side === 'right') {
    const xIn = 100 - R;
    return [
      'polygon(',
      `${L}% ${y0}%,`,
      `${xIn}% ${y0}%,`,
      `${xIn}% ${yTabTop}%,`,
      `100% ${yTabTop}%,`,
      `100% ${yTabBot}%,`,
      `${xIn}% ${yTabBot}%,`,
      `${xIn}% ${y1}%,`,
      `${L}% ${y1}%)`,
    ].join(' ');
  }
  const xIn = L;
  const xOut = 0;
  const xR = 100 - R;
  return [
    'polygon(',
    `${xIn}% ${y0}%,`,
    `${xR}% ${y0}%,`,
    `${xR}% ${yTabTop}%,`,
    `${xOut}% ${yTabTop}%,`,
    `${xOut}% ${yTabBot}%,`,
    `${xR}% ${yTabBot}%,`,
    `${xR}% ${y1}%,`,
    `${xIn}% ${y1}%)`,
  ].join(' ');
}

export const ZeissHandbookPage = forwardRef<HTMLDivElement, ZeissHandbookPageProps>(
  function ZeissHandbookPage(
    {
      title,
      imageData,
      imageUrl,
      pageNumber,
      pageIndex,
      children,
      physicalTabHit = null,
      physicalAnchorPage = false,
      anchorPreservationInsetPct = null,
      isManualTrimmed = false,
    },
    ref,
  ) {
    const [reveal, setReveal] = useState(false);
    const [hover, setHover] = useState(false);
    const src =
      imageData && imageData.length > 0
        ? imageData
        : imageUrl && imageUrl.length > 0
          ? imageUrl
          : null;

    const [trimImgSrc, setTrimImgSrc] = useState<string | null>(null);
    useEffect(() => {
      setTrimImgSrc(src);
    }, [src]);

    const effectivePhysicalAnchor = physicalAnchorPage && !isManualTrimmed;

    const insetPct = useMemo(() => {
      if (!effectivePhysicalAnchor) return null;
      if (anchorPreservationInsetPct) return anchorPreservationInsetPct;
      const side = physicalTabHit?.side ?? 'right';
      return side === 'left' ? DEFAULT_INSET_LEFT_TAB : DEFAULT_INSET_RIGHT_TAB;
    }, [effectivePhysicalAnchor, anchorPreservationInsetPct, physicalTabHit?.side]);

    const clipStyle: React.CSSProperties | undefined = useMemo(() => {
      if (!insetPct || !effectivePhysicalAnchor) return undefined;
      if (physicalTabHit) {
        const side = physicalTabHit.side ?? 'right';
        const poly = buildAnchorLShapeClipPath(insetPct, side, physicalTabHit.vOffsetPercent);
        return { clipPath: poly, WebkitClipPath: poly };
      }
      return {
        clipPath: `inset(${insetPct.top}% ${insetPct.right}% ${insetPct.bottom}% ${insetPct.left}% round 3px)`,
        WebkitClipPath: `inset(${insetPct.top}% ${insetPct.right}% ${insetPct.bottom}% ${insetPct.left}% round 3px)`,
      };
    }, [insetPct, effectivePhysicalAnchor, physicalTabHit]);

    const imgSrc = isManualTrimmed && trimImgSrc ? trimImgSrc : src;

    const onRasterError = useCallback(() => {
      setReveal(true);
      if (!isManualTrimmed) return;
      if (!trimImgSrc) return;
      if (trimImgSrc.endsWith('.jpg') || trimImgSrc.endsWith('.jpeg')) {
        const png = trimImgSrc.replace(/\.jpe?g$/i, '.png');
        if (png !== trimImgSrc) {
          setTrimImgSrc(png);
          return;
        }
      }
      if (trimImgSrc.endsWith('.png')) {
        const jpg = trimImgSrc.replace(/\.png$/i, '.jpg');
        if (jpg !== trimImgSrc) setTrimImgSrc(jpg);
      }
    }, [isManualTrimmed, trimImgSrc]);

    const onDefaultRasterError = useCallback(() => {
      setReveal(true);
    }, []);

    const renderHitLayer = () => {
      if (isManualTrimmed) return null;
      if (!physicalTabHit) return null;
      const vp = Math.min(99.5, Math.max(0.5, physicalTabHit.vOffsetPercent));
      const hpRaw = physicalTabHit.hOffsetPercent;
      const hasH =
        typeof hpRaw === 'number' && Number.isFinite(hpRaw)
          ? Math.min(99.5, Math.max(0.5, hpRaw))
          : null;
      const side: 'right' | 'left' = physicalTabHit.side ?? 'right';

      const strip: React.CSSProperties = {
        position: 'absolute',
        top: `${vp}%`,
        height: HIT_STRIP_H,
        transform: 'translateY(-50%)',
        backgroundColor: 'transparent',
      };
      if (side === 'right') {
        const leftPct = hasH != null ? hasH : 100 - HIT_STRIP_INWARD_PCT;
        strip.left = `${leftPct}%`;
        strip.right = `${-HIT_STRIP_OVERFLOW_OUT}px`;
      } else {
        const rightPct = hasH != null ? 100 - hasH : 100 - HIT_STRIP_INWARD_PCT;
        strip.right = `${rightPct}%`;
        strip.left = `${-HIT_STRIP_OVERFLOW_OUT}px`;
      }

      const debugOn =
        typeof window !== 'undefined' &&
        /[?&]debugHitStrip=1\b/.test(window.location.search);
      if (debugOn) {
        const tint = physicalTabHit.activeHighlightColor ?? 'rgba(56,189,248,0.5)';
        strip.backgroundColor = tint.replace(/[\d.]+\)$/u, `${hover ? 0.25 : 0.12})`);
        strip.outline = '1px dashed rgba(255,255,255,0.35)';
      }

      return (
        <button
          type="button"
          aria-label={physicalTabHit.ariaLabel}
          title={physicalTabHit.tooltipLabel ?? physicalTabHit.ariaLabel}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          onClick={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            physicalTabHit.onSelect();
          }}
          style={strip}
          className={[
            'pointer-events-auto cursor-pointer border-0 p-0 outline-none focus-visible:ring-1 focus-visible:ring-white/30',
            isManualTrimmed ? 'z-[100]' : 'z-[6]',
          ].join(' ')}
        />
      );
    };

    if (!src) {
      return (
        <div
          ref={ref}
          data-density="compact"
          data-stf-page-index={pageIndex !== undefined ? String(pageIndex) : undefined}
          className="stf__page-root relative h-full w-full overflow-hidden rounded-l-sm border border-white/[0.08] bg-gradient-to-b from-slate-900 to-[#0a0f14]"
        >
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        data-density="compact"
        data-stf-page-index={pageIndex !== undefined ? String(pageIndex) : undefined}
        data-physical-anchor={effectivePhysicalAnchor ? '1' : '0'}
        data-hoya-manual-trim={isManualTrimmed ? '1' : undefined}
        className={[
          // 与 .stf__item 内联高宽 1:1；无 physicalTabHit 时裁在槽内，图与内层已 overflow-hidden，左右等高
          'stf__page-root relative box-border h-full max-h-full min-h-0 w-full min-w-0',
          physicalTabHit && !isManualTrimmed ? 'overflow-visible' : isManualTrimmed ? '' : 'overflow-hidden',
          isManualTrimmed
            ? 'hoya-manual-trim-page h-auto max-h-none overflow-visible bg-transparent'
            : ['rounded-l-sm border border-white/12', physicalAnchorPage ? 'bg-transparent' : 'bg-[#0a0f14]'].join(
                ' ',
              ),
        ]
          .filter((c) => c && c.length > 0)
          .join(' ')}
        style={isManualTrimmed ? undefined : { boxShadow: PAPER_STACK_SHADOW }}
      >
        {isManualTrimmed ? (
          <div className="hoya-manual-trim-media pointer-events-none absolute inset-0 overflow-visible">
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 价目册栅格 dataURL / 动态路径
              <img
                key={`${pageNumber}-hoya-${imgSrc.length}`}
                src={imgSrc}
                alt={title || `手册第 ${pageNumber} 页`}
                decoding="async"
                loading="eager"
                draggable={false}
                onLoad={() => setReveal(true)}
                onError={onRasterError}
                className={[
                  'hoya-manual-trim-img hoya-hidpr-img pointer-events-none absolute inset-0 h-full w-full object-contain',
                  'transition-opacity ease-out duration-300',
                  reveal ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
              />
            ) : null}
          </div>
        ) : (
          <div
            className="pointer-events-none absolute inset-0 min-h-0 min-w-0 bg-[#0a0f14] rounded-l-sm"
            style={clipStyle}
          >
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={pageNumber}
                src={imgSrc}
                alt={title || `手册第 ${pageNumber} 页`}
                decoding="async"
                loading="eager"
                draggable={false}
                onLoad={() => setReveal(true)}
                onError={onDefaultRasterError}
                className={[
                  'pointer-events-none absolute inset-0 h-full w-full object-cover',
                  'transition-opacity ease-out duration-300',
                  reveal ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
              />
            ) : null}
          </div>
        )}
        {renderHitLayer()}
        {children}
      </div>
    );
  },
);
