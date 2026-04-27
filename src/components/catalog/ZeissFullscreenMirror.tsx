'use client';

/**
 * ZeissFullscreenMirror — StandardEye 4.0 焦土镜像（无独立 fixed 壳）
 *
 * 父级必为 {@link ZeissFsMirrorPortal} 的唯一 `div.fixed.inset-0`。
 * 物理层：双图底座内 **仅** 两张 `<img>`（50vw×100vh、fill），缩放矩阵只作用于 `[data-zeiss-fs-dual-base]`。
 * 交互层：HandbookFsInteractionZone 幽灵路由（15% 边区 + 键盘）；指纹 clientX/window.innerWidth。
 * 侧栏：fixed + data-zeiss-fs-rail-fixed，零 page-flip / stf__ 类名。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { HandbookFsInteractionZone } from '@/components/catalog/HandbookFsInteractionZone';
import { ZeissHandbookShortcutRail } from '@/components/catalog/ZeissHandbookShortcutRail';
import { getPageData } from '@/data/zeissHandbookPageMap';

const PAGE_W = 450;
const PAGE_H = Math.floor(PAGE_W * 1.4145);
const RAIL_W = 60;

/** 捏合原点：视口水平中轴顶 — 与中缝共线 */
const FS_MIRROR_TRANSFORM_ORIGIN = '50vw 0';

export interface ZeissFullscreenMirrorProps {
  currentPage: number;
  total: number;
  onNavigate: (delta: number) => void;
  onNavigateToPage: (page0: number) => void;
  onClose: () => void;
}

function FsFloatingRail({
  currentPageIndex0,
  pageCount,
  onNavigateToPageIndex0,
}: {
  currentPageIndex0: number;
  pageCount: number;
  onNavigateToPageIndex0?: (pageIndex0: number) => void;
}) {
  return (
    <div
      data-zeiss-fs-rail-fixed="1"
      style={{
        width: RAIL_W,
      }}
    >
      <ZeissHandbookShortcutRail
        currentPageIndex0={currentPageIndex0}
        pageCount={pageCount}
        onNavigateToPageIndex0={onNavigateToPageIndex0}
      />
    </div>
  );
}

export function ZeissFullscreenMirror({
  currentPage,
  total,
  onNavigate,
  onNavigateToPage,
  onClose,
}: ZeissFullscreenMirrorProps) {
  const dualBaseRef = useRef<HTMLDivElement>(null);

  const handleFsTransformChange = useCallback(
    (xform: { x: number; y: number; scale: number }) => {
      const el = dualBaseRef.current;
      if (!el) return;
      el.style.transformOrigin = FS_MIRROR_TRANSFORM_ORIGIN;
      el.style.transform = `translate3d(${xform.x}px, ${xform.y}px, 0) scale(${xform.scale})`;
    },
    [],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        onNavigate(2);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        onNavigate(-2);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onNavigate, onClose]);

  const spread = useMemo(() => {
    const getImg = (p1: number) => {
      const pd = getPageData(p1, 'zeiss');
      const url = pd?.imageUrl?.trim();
      return {
        src: (url && url.length > 0 ? url : null) ?? pd?.imageData ?? '',
        alt: pd?.title ?? `第 ${p1} 页`,
      };
    };
    if (total <= 0) return { left: null, right: null };
    const leftP1 = Math.min(total, Math.max(1, currentPage + 1));
    const rightP1 = leftP1 + 1;
    return {
      left: getImg(leftP1),
      right: rightP1 <= total ? getImg(rightP1) : null,
    };
  }, [currentPage, total]);

  const emptyHalf: CSSProperties = {
    position: 'absolute',
    top: 0,
    width: '50vw',
    height: '100vh',
    background: '#111',
    boxSizing: 'border-box',
  };

  return (
    <>
      {/* Layer 0 — 双图底座：仅两枚 img + 缩放矩阵 */}
      <div
        ref={dualBaseRef}
        data-zeiss-fs-dual-base="1"
        style={{ transformOrigin: FS_MIRROR_TRANSFORM_ORIGIN }}
      >
        {spread.left?.src ? (
          <img
            className="zeiss-fs-mirror-img"
            data-zeiss-fs-half="L"
            data-zeiss-fs-layer0-img="left"
            src={spread.left.src}
            alt={spread.left.alt}
            decoding="async"
            draggable={false}
          />
        ) : (
          <div aria-hidden style={{ ...emptyHalf, left: 0 }} />
        )}
        {spread.right?.src ? (
          <img
            className="zeiss-fs-mirror-img"
            data-zeiss-fs-half="R"
            data-zeiss-fs-layer0-img="right"
            src={spread.right.src}
            alt={spread.right.alt}
            decoding="async"
            draggable={false}
          />
        ) : (
          <div aria-hidden style={{ ...emptyHalf, left: '50vw' }} />
        )}
      </div>

      {/* Layer 1 — 幽灵路由：全透明，不渲染书页像素 */}
      <HandbookFsInteractionZone
        innerFill
        userZoomEnabled
        baseScale={1}
        visualTransformOrigin={FS_MIRROR_TRANSFORM_ORIGIN}
        onTransformChange={handleFsTransformChange}
        onNavigate={onNavigate}
        currentPage={currentPage}
        pageW={PAGE_W}
        pageH={PAGE_H}
        brand="zeiss"
        className="handbook-fs-interaction-zone"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          background: 'transparent',
        }}
      >
        <div data-handbook-fs-spread-anchor="1" className="absolute inset-0" aria-hidden />
      </HandbookFsInteractionZone>

      <FsFloatingRail
        currentPageIndex0={currentPage}
        pageCount={total}
        onNavigateToPageIndex0={onNavigateToPage}
      />

      <button
        type="button"
        onClick={onClose}
        aria-label="退出全屏"
        className="absolute right-4 top-4 z-[100] flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/70 text-white shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition hover:bg-slate-900/80"
      >
        <X className="h-6 w-6" strokeWidth={2.4} />
      </button>
    </>
  );
}
