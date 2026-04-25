'use client';

import { useCallback, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';

const PUNCH_HOLE_COUNT = 6;

/**
 * 荔枝纹皮革：父级为 `z-[6]` 垫底。书芯 `HTMLFlipBook` 在 `ZeissDigitalHandbook` 中一般为 `z-[12]`；
 * {@link HandbookPunchHolesOverlay} 的 AO/纸缘/活页条为 z 8/19/25，叠在书缘而不盖住整页内容。
 */
export function HandbookBinderLeatherField({ className = '' }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const fid = `stf-leather-grain-${uid}`;
  const pid = `stf-leather-pebble-${uid}`;

  return (
    <div
      className={['pointer-events-none absolute inset-0 z-[6] overflow-hidden', className].filter(Boolean).join(' ')}
      aria-hidden
    >
      <div className="leather-field absolute inset-0 z-0" aria-hidden />
      {/* 主光照：径向 + 145° 微弱侧光（皮质体积感） */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background: `
            linear-gradient(145deg, rgba(255,255,255,0.045) 0%, transparent 42%, rgba(0,0,0,0.18) 100%),
            repeating-linear-gradient(122deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 6px),
            repeating-linear-gradient(-58deg, rgba(0,0,0,0.06) 0 1px, transparent 1px 5px),
            radial-gradient(ellipse 105% 95% at 50% 36%, #242424 0%, #1a1a1a 38%, #141414 62%, #0f0f0f 82%, #0a0a0a 100%)
          `,
          backgroundBlendMode: 'soft-light, overlay, overlay, normal',
        }}
      />
      {/* 粗荔枝纹：低频 feTurbulence */}
      <svg
        className="absolute inset-0 z-[1] h-full w-full opacity-[0.38] mix-blend-overlay"
        aria-hidden
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={fid} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="grain" />
            <feColorMatrix
              in="grain"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0"
              result="tinted"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${fid})`} />
      </svg>
      {/* 细颗粒 / 荔枝皮点：高频噪声叠层 */}
      <svg
        className="absolute inset-0 z-[1] h-full w-full opacity-[0.22] mix-blend-overlay"
        aria-hidden
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={pid} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" stitchTiles="stitch" result="p" />
            <feColorMatrix
              in="p"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.42 0"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${pid})`} />
      </svg>
      {/* 微弱顶光 */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] opacity-32 mix-blend-soft-light"
        style={{
          background: 'radial-gradient(ellipse 80% 55% at 50% 0%, rgba(255,255,255,0.07), transparent 58%)',
        }}
      />
    </div>
  );
}

function readFlipRender(flipRef: RefObject<ReactPageFlipRef | null>) {
  return flipRef.current?.pageFlip?.()?.getRender?.();
}

type FlipRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
};

/**
 * 活页圆孔 + 纸张浮起 AO + 纸缘 1px 高光（坐标与 page-flip getRect 对齐）
 */
export function HandbookPunchHolesOverlay({
  flipRef,
  layoutTick,
  bookWidth,
  bookMinHeight,
  flipInstanceKey,
}: {
  flipRef: RefObject<ReactPageFlipRef | null>;
  layoutTick: number;
  bookWidth: number;
  bookMinHeight: number;
  flipInstanceKey: string | number;
}) {
  const aoRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const sync = useCallback(() => {
    const ao = aoRef.current;
    const rim = rimRef.current;
    const strip = stripRef.current;
    if (!ao || !rim || !strip) return;
    const parent = strip.parentElement;
    if (!parent) return;

    const render = readFlipRender(flipRef);
    if (!render?.getRect || typeof render.getOrientation !== 'function') {
      strip.style.opacity = '0';
      ao.style.opacity = '0';
      rim.style.opacity = '0';
      return;
    }

    let r: FlipRect;
    try {
      r = render.getRect() as FlipRect;
    } catch {
      strip.style.opacity = '0';
      ao.style.opacity = '0';
      rim.style.opacity = '0';
      return;
    }

    if (!r || !Number.isFinite(r.height) || r.height < 48) {
      strip.style.opacity = '0';
      ao.style.opacity = '0';
      rim.style.opacity = '0';
      return;
    }

    const orientation = render.getOrientation();
    const paperLeft = orientation === 'portrait' ? r.left + r.pageWidth : r.left;
    const stripW = Math.max(9, Math.min(20, r.pageWidth * 0.05));
    /** 向左渗入皮革区，营造「扣在皮套里」 */
    const stripLeft = paperLeft - Math.min(5, stripW * 0.38);

    const applyBox = (el: HTMLDivElement, rect: FlipRect) => {
      el.style.position = 'absolute';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.pointerEvents = 'none';
    };

    // AO：画布下方皮革上的柔和接触影
    applyBox(ao, r);
    ao.style.zIndex = '8';
    ao.style.opacity = '1';
    ao.style.borderRadius = '2px';
    ao.style.transform = 'translateY(5px) scale(1.02, 1.06)';
    ao.style.filter = 'blur(18px)';
    ao.style.background = 'radial-gradient(ellipse 92% 55% at 50% 0%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 45%, transparent 72%)';
    ao.style.mixBlendMode = 'multiply';

    // 纸缘 1px 高光（与皮革交界处）
    applyBox(rim, r);
    rim.style.zIndex = '19';
    rim.style.opacity = '1';
    rim.style.borderRadius = '1px';
    /** 纸张「陷」入厚皮套：左右大半径影 + 纸缘高光 */
    rim.style.boxShadow = `
      20px 0 50px rgba(0,0,0,0.6),
      -20px 0 50px rgba(0,0,0,0.6),
      inset 0 0 0 1px rgba(255,255,255,0.11),
      inset 0 1px 0 rgba(255,255,255,0.06)
    `;

    strip.style.opacity = '1';
    strip.style.position = 'absolute';
    strip.style.left = `${stripLeft}px`;
    strip.style.top = `${r.top}px`;
    strip.style.width = `${stripW}px`;
    strip.style.height = `${r.height}px`;
    strip.style.display = 'flex';
    strip.style.flexDirection = 'column';
    strip.style.alignItems = 'center';
    strip.style.justifyContent = 'space-evenly';
    strip.style.padding = `${r.height * 0.05}px 0`;
    strip.style.boxSizing = 'border-box';
    strip.style.pointerEvents = 'none';
    strip.style.zIndex = '25';
    strip.style.filter = 'drop-shadow(-5px 0 7px rgba(0,0,0,0.65))';

    const d = Math.max(5, Math.min(14, stripW * 0.88, r.height * 0.052));
    strip.style.setProperty('--punch-d', `${d}px`);
  }, [flipRef]);

  useLayoutEffect(() => {
    const run = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        sync();
        requestAnimationFrame(sync);
      });
    };
    run();

    const parent = stripRef.current?.parentElement;
    if (!parent) return () => cancelAnimationFrame(rafRef.current);

    const ro = new ResizeObserver(run);
    ro.observe(parent);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [sync, layoutTick, bookWidth, bookMinHeight, flipInstanceKey]);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div ref={aoRef} className="opacity-0" aria-hidden />
      <div ref={rimRef} className="opacity-0" aria-hidden />
      <div ref={stripRef} className="opacity-0" aria-hidden>
        {Array.from({ length: PUNCH_HOLE_COUNT }, (_, i) => (
          <span
            key={i}
            className="binder-hole"
            style={{
              width: 'var(--punch-d, 14px)',
              height: 'var(--punch-d, 14px)',
            }}
          >
            {/* 左侧弧形高光（金属扣反光环内侧） */}
            <span
              className="pointer-events-none absolute left-0 top-1/2 block h-[58%] w-[32%] -translate-y-1/2 rounded-l-full"
              style={{
                background: 'linear-gradient(90deg, rgba(70,70,70,0.4) 0%, transparent 88%)',
              }}
              aria-hidden
            />
          </span>
        ))}
      </div>
    </div>
  );
}
