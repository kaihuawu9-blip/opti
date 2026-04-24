'use client';

import { forwardRef, useState } from 'react';

/**
 * 透明感应层（Invisible Hit Layer）：作为 Page 的 `absolute` 子元素，**不绘制任何可见像素**。
 *
 * - 「标签」已印在 PDF 画面里（蓝色/橙色色块等），我们**不再画**任何 UI。
 * - 感应层在色块垂直高度上，从 PDF 内部**溢出**到纸缘外（右页向右、左页向左），
 *   形成横跨内外的点击条；它是 Page 的子元素，随 3D 翻页引擎一起旋转、透视、翻转。
 *
 * StandardEye V1.6「成品图模式」：
 * - PDF 页图已在离线工序里按出血位人工预裁好，前端**不再做任何裁剪或坐标重映射**。
 * - v/hOffsetPercent 直接使用成品图坐标，由 AI 扫描产出，对齐色块 1:1。
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

export type ZeissHandbookPageProps = {
  title: string;
  imageData: string | null;
  imageUrl?: string | null;
  pageNumber: number;
  /** 物理凸标热区：坐标直接对齐成品图，由 AI 扫描产出 */
  physicalTabHit?: ZeissHandbookPhysicalTabHit | null;
};

const PAPER_STACK_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.12), inset -2px 0 0 rgba(255,255,255,0.92), inset -5px 0 0 rgba(248,250,252,0.88), inset -9px 0 0 rgba(241,245,249,0.82), inset -13px 0 0 rgba(226,232,240,0.55), inset -16px 0 0 rgba(203,213,225,0.35)';

/** 感应条垂直高度（px）：略大于印刷色块，覆盖点击容差 */
const HIT_STRIP_H = 56;
/** 感应条向页缘外溢出的距离（px） */
const HIT_STRIP_OVERFLOW_OUT = 28;
/** 没有 hOffsetPercent 时，感应条自纸缘向内覆盖的百分比 */
const HIT_STRIP_INWARD_PCT = 16;

export const ZeissHandbookPage = forwardRef<HTMLDivElement, ZeissHandbookPageProps>(
  function ZeissHandbookPage({ title, imageData, imageUrl, pageNumber, physicalTabHit = null }, ref) {
    const [reveal, setReveal] = useState(false);
    const [hover, setHover] = useState(false);
    const src =
      imageData && imageData.length > 0
        ? imageData
        : imageUrl && imageUrl.length > 0
          ? imageUrl
          : null;

    if (!src) {
      return (
        <div
          ref={ref}
          data-density="compact"
          className="stf__page-root relative h-full w-full overflow-hidden rounded-l-sm border border-white/[0.08] bg-gradient-to-b from-slate-900 to-[#0a0f14]"
        />
      );
    }

    const renderHitLayer = () => {
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
          className="pointer-events-auto z-[6] cursor-pointer border-0 p-0 outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        />
      );
    };

    return (
      <div
        ref={ref}
        data-density="compact"
        className="stf__page-root relative h-full w-full rounded-l-sm border border-white/12 bg-[#0a0f14]"
        style={{ boxShadow: PAPER_STACK_SHADOW }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-l-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={pageNumber}
            src={src}
            alt={title || `手册第 ${pageNumber} 页`}
            width={1536}
            height={2048}
            loading="eager"
            decoding="sync"
            onLoad={() => setReveal(true)}
            className={[
              'h-full w-full object-cover object-center',
              'transition-opacity ease-out duration-300',
              reveal ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            draggable={false}
          />
        </div>
        {renderHitLayer()}
      </div>
    );
  },
);
