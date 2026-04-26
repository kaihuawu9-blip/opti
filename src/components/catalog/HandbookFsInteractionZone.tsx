'use client';

/**
 * HandbookFsInteractionZone v5 - rAF router + physical spring monitor.
 *
 * Coordinate replay:
 *   visualX = outerLeft + translateX + contentX * scale
 *   contentX = (visualX - outerLeft - translateX) / scale
 *
 * Spread base rect is recovered from the transformed .stf__parent:
 *   baseLeft  = (spreadRect.left - outerRect.left - translateX) / scale
 *   baseWidth = spreadRect.width / scale
 *
 * Final relative hit:
 *   relSpreadX = (contentX - baseLeft) / baseWidth
 *   relPageX   = left ? relSpreadX * 2 : (relSpreadX - 0.5) * 2
 *
 * The formula explicitly compensates both pan offset and zoom scale, so cashier
 * output remains 1:1 regardless of current viewport transform.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import type { DigitalHandbookBrand } from '@/data/zeissHandbookPageMap';
import {
  buildCashierPayloadFromPdfIndex,
  dispatchHandbookAddToCart,
  dispatchHandbookPageClick,
} from '@/lib/catalog/handbookCashierBridge';
import {
  HandbookInteractionRouter,
  type PageCoord,
  type ProductHotspot,
} from '@/lib/catalog/handbookInteractionRouter';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 10;
const TAP_TIME = 280;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 12;
const SPRING_EPS = 0.45;
const SCALE_EPS = 0.002;

interface Xform {
  x: number;
  y: number;
  scale: number;
}

const IDENTITY: Xform = { x: 0, y: 0, scale: 1 };

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMid(a: Touch, b: Touch): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function almostSame(a: Xform, b: Xform): boolean {
  return (
    Math.abs(a.x - b.x) < SPRING_EPS &&
    Math.abs(a.y - b.y) < SPRING_EPS &&
    Math.abs(a.scale - b.scale) < SCALE_EPS
  );
}

function getViewportLimit(t: Xform, w: number, h: number): Xform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
  const scaledW = w * scale;
  const scaledH = h * scale;

  /*
   * Physical-Constraint-Monitor:
   * - scale is always inside [1, 4].
   * - transformed content must intersect the viewport on both axes.
   * - when content is larger than the viewport, translation stays in the normal
   *   cover range [viewport - scaledContent, 0], keeping at least one physical
   *   corner anchored inside the viewport and preventing "lost screen".
   */
  const minX = Math.min(0, w - scaledW);
  const maxX = 0;
  const minY = Math.min(0, h - scaledH);
  const maxY = 0;

  return {
    x: Math.max(minX, Math.min(maxX, t.x)),
    y: Math.max(minY, Math.min(maxY, t.y)),
    scale,
  };
}

export interface HandbookFsInteractionZoneProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  cashierMode?: boolean;
  currentPage: number;
  pageW: number;
  pageH: number;
  brand?: DigitalHandbookBrand;
  hotspots?: readonly ProductHotspot[];
  onLongPress?: (coord: PageCoord, hotspot: ProductHotspot | null) => void;
  onSidebarToggle?: () => void;
}

export function HandbookFsInteractionZone({
  children,
  style,
  className,
  cashierMode = false,
  currentPage,
  pageW,
  pageH,
  brand = 'zeiss',
  hotspots = [],
  onLongPress,
  onSidebarToggle,
}: HandbookFsInteractionZoneProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const router = useMemo(() => new HandbookInteractionRouter(16), []);

  const xformRef = useRef<Xform>(IDENTITY);
  const pendingXform = useRef<Xform | null>(null);
  const rafId = useRef(0);
  const springId = useRef(0);
  const zoomedRef = useRef(false);
  const [isZoomed, setIsZoomed] = useState(false);

  const pRef = useRef({
    cashierMode,
    currentPage,
    pageW,
    pageH,
    brand,
    hotspots,
    onLongPress,
    onSidebarToggle,
  });

  useEffect(() => {
    pRef.current = {
      cashierMode,
      currentPage,
      pageW,
      pageH,
      brand,
      hotspots,
      onLongPress,
      onSidebarToggle,
    };
  });

  const commitTransform = useCallback((t: Xform): void => {
    const inner = innerRef.current;
    if (!inner) return;

    inner.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;

    const nextZoomed = t.scale > 1.01;
    if (nextZoomed !== zoomedRef.current) {
      zoomedRef.current = nextZoomed;
      setIsZoomed(nextZoomed);
    }
  }, []);

  const flushTransform = useCallback((): void => {
    rafId.current = 0;
    const next = pendingXform.current;
    if (!next) return;
    pendingXform.current = null;
    commitTransform(next);
    router.canProcessGesture();
  }, [commitTransform, router]);

  const scheduleApply = useCallback((next: Xform): void => {
    xformRef.current = next;
    pendingXform.current = next;
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(flushTransform);
    }
  }, [flushTransform]);

  const cancelSpring = useCallback((): void => {
    if (springId.current) {
      cancelAnimationFrame(springId.current);
      springId.current = 0;
    }
  }, []);

  const getConstrainedXform = useCallback((t: Xform): Xform => {
    const outer = outerRef.current;
    if (!outer) return t;
    return getViewportLimit(t, outer.clientWidth || 1, outer.clientHeight || 1);
  }, []);

  const springTo = useCallback((target: Xform): void => {
    cancelSpring();

    const boundedTarget = getConstrainedXform(target);

    const tick = () => {
      const current = xformRef.current;
      const next: Xform = {
        x: current.x + (boundedTarget.x - current.x) * 0.24,
        y: current.y + (boundedTarget.y - current.y) * 0.24,
        scale: current.scale + (boundedTarget.scale - current.scale) * 0.24,
      };

      if (almostSame(next, boundedTarget)) {
        springId.current = 0;
        scheduleApply(boundedTarget);
        return;
      }

      scheduleApply(next);
      springId.current = requestAnimationFrame(tick);
    };

    springId.current = requestAnimationFrame(tick);
  }, [cancelSpring, getConstrainedXform, scheduleApply]);

  const monitorAndSpringBack = useCallback((): void => {
    const safe = getConstrainedXform(xformRef.current);
    if (!almostSame(safe, xformRef.current)) {
      springTo(safe);
    }
  }, [getConstrainedXform, springTo]);

  const buildPageCoord = useCallback((clientX: number, clientY: number): PageCoord | null => {
    const shell = outerRef.current;
    if (!shell) return null;

    const spreadEl = shell.querySelector<HTMLElement>('.stf__parent');
    if (!spreadEl) return null;

    /*
     * 单次布局读取：shell 与实际书槽各读取一次，后续全部用纯数学反投影。
     * 严禁假设书槽在 shell 居中，.stf__parent 是动态基准层的唯一真值。
     */
    const shellRect = shell.getBoundingClientRect();
    const bookRect = spreadEl.getBoundingClientRect();
    const { x, y, scale } = xformRef.current;

    if (scale <= 0) return null;

    const invScale = 1 / scale;

    // 1. 反向投影层：click -> innerRef 逻辑坐标系。
    const logicX = (clientX - shellRect.left - x) * invScale;
    const logicY = (clientY - shellRect.top - y) * invScale;

    // 2. 动态基准层：实时捕获书槽 .stf__parent 在逻辑坐标系中的原点与尺寸。
    const bookLeft = (bookRect.left - shellRect.left - x) * invScale;
    const bookTop = (bookRect.top - shellRect.top - y) * invScale;
    const bookW = bookRect.width * invScale;
    const bookH = bookRect.height * invScale;

    if (bookW <= 0 || bookH <= 0) return null;

    // 3. 计算闭环：normalized = (logicPoint - bookOrigin) / bookSize。
    const normalizedX = (logicX - bookLeft) / bookW;
    const normalizedY = (logicY - bookTop) / bookH;

    // 非书页区域立即丢弃，防止 rail / 背景误触收银。
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
      return null;
    }

    const side: 'left' | 'right' = normalizedX < 0.5 ? 'left' : 'right';
    const relX = side === 'left' ? normalizedX * 2 : (normalizedX - 0.5) * 2;
    const relY = normalizedY;
    const { pageW: pw, pageH: ph } = pRef.current;

    return {
      side,
      relX,
      relY,
      physX: relX * pw,
      physY: relY * ph,
    };
  }, []);

  const dispatchCoord = useCallback((coord: PageCoord): void => {
    const { currentPage: cp, brand: br } = pRef.current;
    dispatchHandbookPageClick({
      pageIndex0: cp,
      side: coord.side,
      relX: coord.relX,
      relY: coord.relY,
      physX: coord.physX,
      physY: coord.physY,
      brand: br,
      pdfPage1Left: cp + 1,
    });
  }, []);

  const sendCashierHotspot = useCallback((hotspot: ProductHotspot): void => {
    const payload = buildCashierPayloadFromPdfIndex(
      Math.max(0, hotspot.pdfPage1 - 1),
      pRef.current.brand,
      hotspot.subsetHint ? { subsetName: hotspot.subsetHint } : undefined,
    );
    if (payload) dispatchHandbookAddToCart(payload);
  }, []);

  const handleTap = useCallback((clientX: number, clientY: number): void => {
    const coord = buildPageCoord(clientX, clientY);
    if (!coord) return;

    const { cashierMode: cm, hotspots: hs, onSidebarToggle: toggle } = pRef.current;
    const decision = router.routeTap({
      coord,
      hotspots: hs,
      isZoomed: zoomedRef.current,
      cashierMode: cm,
    });

    switch (decision.action) {
      case 'CASHIER':
        sendCashierHotspot(decision.hotspot);
        dispatchCoord(decision.coord);
        router.returnToIdle();
        break;
      case 'CASHIER_COORD':
        dispatchCoord(decision.coord);
        router.returnToIdle();
        break;
      case 'ZOOM_RESET':
        springTo(IDENTITY);
        router.returnToIdle();
        break;
      case 'SIDEBAR_TOGGLE':
        toggle?.();
        router.returnToIdle();
        break;
      default:
        router.returnToIdle();
    }
  }, [buildPageCoord, dispatchCoord, router, sendCashierHotspot, springTo]);

  const handleLongPress = useCallback((clientX: number, clientY: number): void => {
    const coord = buildPageCoord(clientX, clientY);
    if (!coord) return;

    const decision = router.routeLongPress(coord, pRef.current.hotspots);
    if (decision.action === 'LONG_PRESS') {
      pRef.current.onLongPress?.(decision.coord, decision.hotspot);
    }
    router.returnToIdle();
  }, [buildPageCoord, router]);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const pinch = { active: false, prevDist: 1, prevMid: { x: 0, y: 0 } };
    const pan = { active: false, sx: 0, sy: 0, startX: 0, startY: 0 };
    const tap = { active: false, sx: 0, sy: 0, t0: 0 };
    let lpTimer: ReturnType<typeof setTimeout> | null = null;

    function clearLongPress(): void {
      if (!lpTimer) return;
      clearTimeout(lpTimer);
      lpTimer = null;
    }

    function startLongPress(clientX: number, clientY: number): void {
      clearLongPress();
      lpTimer = setTimeout(() => {
        tap.active = false;
        handleLongPress(clientX, clientY);
      }, LONG_PRESS_MS);
    }

    function onStart(e: TouchEvent): void {
      cancelSpring();

      if (e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        clearLongPress();

        const a = e.touches[0]!;
        const b = e.touches[1]!;
        pinch.active = true;
        pinch.prevDist = touchDist(a, b);
        pinch.prevMid = touchMid(a, b);
        pan.active = false;
        tap.active = false;
        router.enterZooming();
        return;
      }

      if (e.touches.length !== 1) return;

      const t = e.touches[0]!;
      tap.active = true;
      tap.sx = t.clientX;
      tap.sy = t.clientY;
      tap.t0 = Date.now();
      startLongPress(t.clientX, t.clientY);

      if (zoomedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        pan.active = true;
        pan.sx = t.clientX;
        pan.sy = t.clientY;
        pan.startX = xformRef.current.x;
        pan.startY = xformRef.current.y;
        router.enterPanning();
      }
    }

    function onMove(e: TouchEvent): void {
      if (e.touches.length >= 2 && pinch.active) {
        e.preventDefault();
        e.stopPropagation();
        clearLongPress();

        const a = e.touches[0]!;
        const b = e.touches[1]!;
        const nextDist = touchDist(a, b);
        const nextMid = touchMid(a, b);
        const rect = outer.getBoundingClientRect();

        const nextMx = nextMid.x - rect.left;
        const nextMy = nextMid.y - rect.top;
        const prevMx = pinch.prevMid.x - rect.left;
        const prevMy = pinch.prevMid.y - rect.top;

        const current = xformRef.current;
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, current.scale * (nextDist / pinch.prevDist)),
        );
        const factor = nextScale / current.scale;

        scheduleApply(getConstrainedXform({
          x: nextMx - (prevMx - current.x) * factor,
          y: nextMy - (prevMy - current.y) * factor,
          scale: nextScale,
        }));

        pinch.prevDist = nextDist;
        pinch.prevMid = nextMid;
        tap.active = false;
        return;
      }

      if (e.touches.length === 1 && pan.active) {
        e.preventDefault();
        e.stopPropagation();

        const t = e.touches[0]!;
        const dx = t.clientX - pan.sx;
        const dy = t.clientY - pan.sy;
        const distance = Math.hypot(dx, dy);

        if (distance > LONG_PRESS_SLOP) clearLongPress();
        if (distance > TAP_SLOP) tap.active = false;

        scheduleApply(getConstrainedXform({
          x: pan.startX + dx,
          y: pan.startY + dy,
          scale: xformRef.current.scale,
        }));
      }
    }

    function onEnd(e: TouchEvent): void {
      clearLongPress();
      pinch.active = false;

      if (pan.active) {
        pan.active = false;
        router.returnToIdle();
        monitorAndSpringBack();
      } else if (router.isZooming()) {
        router.returnToIdle();
        monitorAndSpringBack();
      }

      if (tap.active && e.changedTouches.length > 0) {
        const t = e.changedTouches[0]!;
        const dx = t.clientX - tap.sx;
        const dy = t.clientY - tap.sy;
        if (Math.hypot(dx, dy) < TAP_SLOP && Date.now() - tap.t0 < TAP_TIME) {
          handleTap(t.clientX, t.clientY);
        }
        tap.active = false;
      }
    }

    outer.addEventListener('touchstart', onStart, { passive: false, capture: true });
    outer.addEventListener('touchmove', onMove, { passive: false, capture: true });
    outer.addEventListener('touchend', onEnd, { capture: true });
    outer.addEventListener('touchcancel', onEnd, { capture: true });

    return () => {
      clearLongPress();
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (springId.current) cancelAnimationFrame(springId.current);
      router.reset();
      outer.removeEventListener('touchstart', onStart, true);
      outer.removeEventListener('touchmove', onMove, true);
      outer.removeEventListener('touchend', onEnd, true);
      outer.removeEventListener('touchcancel', onEnd, true);
    };
  }, [
    cancelSpring,
    getConstrainedXform,
    handleLongPress,
    handleTap,
    monitorAndSpringBack,
    router,
    scheduleApply,
  ]);

  const handleDblClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    cancelSpring();

    const outer = outerRef.current;
    if (!outer) return;

    if (xformRef.current.scale > 1.01) {
      springTo(IDENTITY);
      return;
    }

    const rect = outer.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    springTo({
      x: localX * (1 - DOUBLE_TAP_SCALE),
      y: localY * (1 - DOUBLE_TAP_SCALE),
      scale: DOUBLE_TAP_SCALE,
    });
  }, [cancelSpring, springTo]);

  const mousePan = useRef({
    active: false,
    sx: 0,
    sy: 0,
    startX: 0,
    startY: 0,
  });

  const onOverlayPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    cancelSpring();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    mousePan.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      startX: xformRef.current.x,
      startY: xformRef.current.y,
    };
    router.enterPanning();
  }, [cancelSpring, router]);

  const onOverlayPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!mousePan.current.active) return;
    e.stopPropagation();
    scheduleApply(getConstrainedXform({
      x: mousePan.current.startX + (e.clientX - mousePan.current.sx),
      y: mousePan.current.startY + (e.clientY - mousePan.current.sy),
      scale: xformRef.current.scale,
    }));
  }, [getConstrainedXform, scheduleApply]);

  const onOverlayPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!mousePan.current.active) return;
    mousePan.current.active = false;
    e.stopPropagation();
    router.returnToIdle();
    monitorAndSpringBack();
  }, [monitorAndSpringBack, router]);

  return (
    <div
      ref={outerRef}
      style={{
        position: 'relative',
        touchAction: 'none',
        overscrollBehavior: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        ...style,
      }}
      className={className}
      onDoubleClick={handleDblClick}
    >
      <div
        ref={innerRef}
        style={{
          transformOrigin: '0 0',
          transform: 'translate3d(0px, 0px, 0) scale(1)',
          willChange: 'transform',
        }}
      >
        {children}
      </div>

      {isZoomed && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 75,
            cursor: 'grab',
            touchAction: 'none',
            overscrollBehavior: 'none',
          }}
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onOverlayPointerMove}
          onPointerUp={onOverlayPointerUp}
          onPointerCancel={onOverlayPointerUp}
        />
      )}
    </div>
  );
}
