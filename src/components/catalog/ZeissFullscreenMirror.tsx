'use client';

/**
 * ZeissFullscreenMirror — StandardEye 4.0 暴力满幅镜像
 *
 * 父级必为 {@link ZeissFsMirrorPortal} 的唯一 `div.fixed.inset-0`。
 * 物理层：仅两枚 `<img>`（50vw×100vh、fill、左贴左 / 右贴右），无 ScaledBlock / BookStage / 坐标矩阵。
 * 翻页：左 20% / 右 20% 点击 ±2 跨幅；中央 60% 指纹 → {@link dispatchHandbookPageClick}（screenRelX = clientX/innerWidth）。
 * 严禁本组件内捏合/平移/缩放；侧栏 fixed 浮于图上。
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { ZeissHandbookShortcutRail } from '@/components/catalog/ZeissHandbookShortcutRail';
import { getPageData } from '@/data/zeissHandbookPageMap';
import {
  dispatchHandbookPageClick,
  type HandbookPageClickCoord,
} from '@/lib/catalog/handbookCashierBridge';

const RAIL_W = 60;

function buildCoordFromClient(
  clientX: number,
  clientY: number,
  pageIndex0: number,
): HandbookPageClickCoord {
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const screenRelX = clientX / iw;
  const screenRelY = clientY / ih;
  const side: 'left' | 'right' = screenRelX < 0.5 ? 'left' : 'right';
  const relX = side === 'left' ? screenRelX * 2 : (screenRelX - 0.5) * 2;
  const relY = screenRelY;
  return {
    pageIndex0,
    side,
    relX,
    relY,
    screenRelX,
    screenRelY,
    spreadRelX: screenRelX,
    spreadRelY: screenRelY,
    physX: relX,
    physY: relY,
    brand: 'zeiss',
    pdfPage1Left: pageIndex0 + 1,
  };
}

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

  const emptyHalf = useCallback(
    (side: 'L' | 'R'): CSSProperties => ({
      position: 'absolute',
      top: 0,
      width: '50vw',
      height: '100vh',
      background: '#ffffff',
      boxSizing: 'border-box',
      ...(side === 'L' ? { left: 0, right: 'auto' } : { right: 0, left: 'auto' }),
    }),
    [],
  );

  const onOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const iw = window.innerWidth;
      const rx = e.clientX / iw;
      if (rx < 0.2) {
        onNavigate(-2);
        return;
      }
      if (rx > 0.8) {
        onNavigate(2);
        return;
      }
      dispatchHandbookPageClick(
        buildCoordFromClient(e.clientX, e.clientY, currentPage),
      );
    },
    [currentPage, onNavigate],
  );

  return (
    <>
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
        <div aria-hidden style={emptyHalf('L')} />
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
        <div aria-hidden style={emptyHalf('R')} />
      )}

      <div
        role="presentation"
        data-zeiss-fs-click-router="1"
        className="absolute inset-0 z-10 bg-transparent"
        onClick={onOverlayClick}
      />

      <FsFloatingRail
        currentPageIndex0={currentPage}
        pageCount={total}
        onNavigateToPageIndex0={onNavigateToPage}
      />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="退出全屏"
        className="absolute right-4 top-4 z-[100] flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/70 text-white shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition hover:bg-slate-900/80"
      >
        <X className="h-6 w-6" strokeWidth={2.4} />
      </button>
    </>
  );
}
