'use client';

/**
 * HandbookFsInteractionZone v7 — StandardEye 4.0 · Physical Supremacy
 *
 * 架构原则：
 *   物理层（Layer 0）已保证左图撞左缘、右图撞右缘、中缝焊死在 50% 视口中轴。
 *   全屏 Hard-Fill 下：`screenRelX = clientX / window.innerWidth` 为跨幅真值
 *   （与物理中缝 innerWidth/2 对齐），无 layout 视口与 inner 视口分裂。
 *
 *   `visualTransformOrigin`：全屏双图镜像与手势 inner 共用同一原点，
 *   捏合缩放直接作用于底层镜像层时抑制中缝漂移。
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
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
/** 含全屏 `baseScale`（screen-cover 可 >4）与捏合上限 */
const MAX_SCALE = 10;
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

function viewportMinScale(baseScale: number): number {
  const s = Number(baseScale);
  if (!Number.isFinite(s) || s <= 0) return MIN_SCALE;
  return Math.max(0.08, Math.min(MAX_SCALE, s));
}

function getViewportLimit(t: Xform, w: number, h: number, minScale: number): Xform {
  const scale = Math.min(MAX_SCALE, Math.max(minScale, t.scale));
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
  /**
   * 为 false 时锁定手势缩放：平移恒为 0，`scale` 恒为 `baseScale`（非 1）。
   * 全屏语义填充下「正常态」= 撞边比例，由父级传入（如 `innerHeight / pageH * 1.05`）。
   */
  userZoomEnabled?: boolean;
  /** `userZoomEnabled=false` 时的 resting `scale`；默认 `1` */
  baseScale?: number;
  /**
   * CSS-fill 模式（StandardEye 4.0 物理主权）：
   * `true` → `innerRef` 使用 `position:absolute;inset:0`，内容由 CSS 撑满容器；
   * `baseScale` 应为 `1`，交互层在已撑满内容上叠加缩放/平移。
   * `false`（默认）→ 保持静态块布局，由父层传入 `baseScale` 做视觉缩放。
   */
  innerFill?: boolean;
  /**
   * 每次 `commitTransform` 后调用，携带最新 `{ x, y, scale }`。
   * 用于将手势层的变换同步给独立渲染的图像层（视觉层与手势层分离时使用）。
   */
  onTransformChange?: (xform: { x: number; y: number; scale: number }) => void;
  /**
   * 手势 inner 与父级镜像层的 `transform-origin`（全屏建议 `50vw 0` 锁中缝）。
   * 默认 `0 0`。
   */
  visualTransformOrigin?: string;
  cashierMode?: boolean;
  currentPage: number;
  pageW: number;
  pageH: number;
  brand?: DigitalHandbookBrand;
  hotspots?: readonly ProductHotspot[];
  onLongPress?: (coord: PageCoord, hotspot: ProductHotspot | null) => void;
  onSidebarToggle?: () => void;
  /**
   * 全屏翻页回调：delta=+2 前进，delta=-2 后退。
   * 在 tap（touch）和单击（mouse）未触发 cashier/zoom 动作时调用。
   */
  onNavigate?: (delta: number) => void;
}

export function HandbookFsInteractionZone({
  children,
  style,
  className,
  userZoomEnabled = true,
  baseScale = 1,
  innerFill = false,
  onTransformChange,
  visualTransformOrigin = '0 0',
  cashierMode = false,
  currentPage,
  pageW,
  pageH,
  brand = 'zeiss',
  hotspots = [],
  onLongPress,
  onSidebarToggle,
  onNavigate,
}: HandbookFsInteractionZoneProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const router = useMemo(() => new HandbookInteractionRouter(16), []);
  const userZoomEnabledRef = useRef(userZoomEnabled);
  userZoomEnabledRef.current = userZoomEnabled;
  const baseScaleRef = useRef(baseScale);
  baseScaleRef.current = baseScale;

  const restXform = useCallback((): Xform => {
    const s = Number(baseScaleRef.current);
    const scale = Number.isFinite(s) && s > 0 ? Math.max(0.08, Math.min(MAX_SCALE, s)) : 1;
    return { x: 0, y: 0, scale };
  }, []);

  /** 首帧 inner `scale`：全屏 cover 与锁定态均用 `baseScale`，禁止从 1 闪一下 */
  const innerRestScale = useMemo(() => {
    const s = Number(baseScale);
    if (!Number.isFinite(s) || s <= 0) return 1;
    return Math.max(0.08, Math.min(MAX_SCALE, s));
  }, [baseScale]);

  /**
   * 与首屏 inner 一致：translate 恒 (0,0)，scale = `innerRestScale`（全屏 cover 时 ≠1）。
   * 禁止 ref 首值为 scale=1 而 DOM 已为 baseScale 的「缩进」漂移；`transform` 仅由 commitTransform 写 DOM，避免父重渲染覆盖手势矩阵。
   */
  const xformRef = useRef<Xform>({ x: 0, y: 0, scale: innerRestScale });
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
    onNavigate,
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
      onNavigate,
    };
  });

  const onTransformChangeRef = useRef(onTransformChange);
  onTransformChangeRef.current = onTransformChange;

  const visualTransformOriginRef = useRef(visualTransformOrigin);
  visualTransformOriginRef.current = visualTransformOrigin;

  const commitTransform = useCallback((t: Xform): void => {
    const inner = innerRef.current;
    if (!inner) return;

    inner.style.transformOrigin = visualTransformOriginRef.current;
    inner.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;

    onTransformChangeRef.current?.({ x: t.x, y: t.y, scale: t.scale });

    const baseline = viewportMinScale(baseScaleRef.current);
    const nextZoomed = t.scale > baseline + 0.02;
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

  const scheduleApply = useCallback(
    (next: Xform): void => {
      const eff = userZoomEnabledRef.current ? next : restXform();
      xformRef.current = eff;
      pendingXform.current = eff;
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flushTransform);
      }
    },
    [flushTransform, restXform],
  );

  const cancelSpring = useCallback((): void => {
    if (springId.current) {
      cancelAnimationFrame(springId.current);
      springId.current = 0;
    }
  }, []);

  /** 锁定缩放：resting = translate(0)+`baseScale` */
  useLayoutEffect(() => {
    if (userZoomEnabled) return;
    cancelSpring();
    const rest = restXform();
    xformRef.current = rest;
    pendingXform.current = null;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    commitTransform(rest);
    zoomedRef.current = false;
    setIsZoomed(false);
  }, [userZoomEnabled, baseScale, visualTransformOrigin, cancelSpring, commitTransform, restXform]);

  /**
   * 可缩放手势：首帧 resting = translate3d(0,0,0) + scale(baseScale)，禁止 ref/DOM 双轨。
   * ZOOM_RESET / 约束均以 `baseScale` 为语义地板。
   */
  useLayoutEffect(() => {
    if (!userZoomEnabled) return;
    cancelSpring();
    const rest = restXform();
    xformRef.current = rest;
    pendingXform.current = null;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    commitTransform(rest);
    zoomedRef.current = false;
    setIsZoomed(false);
  }, [userZoomEnabled, baseScale, visualTransformOrigin, cancelSpring, commitTransform, restXform]);

  const getConstrainedXform = useCallback(
    (t: Xform): Xform => {
      if (!userZoomEnabledRef.current) return restXform();
      const outer = outerRef.current;
      if (!outer) return t;
      return getViewportLimit(
        t,
        outer.clientWidth || 1,
        outer.clientHeight || 1,
        viewportMinScale(baseScaleRef.current),
      );
    },
    [restXform],
  );

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

  /**
   * 比例指纹坐标（StandardEye 4.0 · Hard-Fill）：
   *   仅采集 clientX / window.innerWidth、clientY / window.innerHeight；
   *   与物理中缝 innerWidth/2 对齐，零固定 px 命中判断。
   */
  const buildPageCoord = useCallback((clientX: number, clientY: number): PageCoord | null => {
    if (typeof window === 'undefined') return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 0 || vh <= 0) return null;

    const screenRelX = Math.max(0, Math.min(1, clientX / vw));
    const screenRelY = Math.max(0, Math.min(1, clientY / vh));

    const side: 'left' | 'right' = screenRelX < 0.5 ? 'left' : 'right';
    const relX = side === 'left' ? screenRelX * 2 : (screenRelX - 0.5) * 2;
    const relY = screenRelY;

    return {
      side,
      relX,
      relY,
      screenRelX,
      screenRelY,
      spreadRelX: screenRelX,
      spreadRelY: screenRelY,
      physX: relX,
      physY: relY,
    };
  }, []);

  const dispatchCoord = useCallback((coord: PageCoord): void => {
    const { currentPage: cp, brand: br } = pRef.current;
    dispatchHandbookPageClick({
      pageIndex0: cp,
      side: coord.side,
      relX: coord.relX,
      relY: coord.relY,
      screenRelX: coord.screenRelX,
      screenRelY: coord.screenRelY,
      spreadRelX: coord.spreadRelX,
      spreadRelY: coord.spreadRelY,
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

  /**
   * 点击三区路由（StandardEye 4.0 · 中央交互事件路由器）：
   *
   *   ┌──────────┬───────────────────────────────────┬──────────┐
   *   │  左 15%  │        中心 70%（指纹区）           │  右 15%  │
   *   │  ← prev  │  dispatchCoord → 指纹 → 收银台    │  next →  │
   *   └──────────┴───────────────────────────────────┴──────────┘
   *
   *   缩放态：单击回弹至静止态（不进入任何区域路由）。
   *   双击放大已废弃（取消点击放大）。
   */
  const handleTap = useCallback((clientX: number, clientY: number): void => {
    const coord = buildPageCoord(clientX, clientY);
    if (!coord) return;

    const { cashierMode: cm, hotspots: hs, onNavigate: nav } = pRef.current;

    // 缩放态：回弹
    if (zoomedRef.current) {
      springTo(restXform());
      router.returnToIdle();
      return;
    }

    // 三区路由
    if (coord.screenRelX < 0.15) {
      // 左 15%：上一跨幅
      nav?.(-2);
    } else if (coord.screenRelX > 0.85) {
      // 右 15%：下一跨幅
      nav?.(2);
    } else {
      // 中心 70%：语义坐标 → 指纹引擎 → 收银台
      dispatchCoord(coord);
      if (cm && hs.length > 0) {
        const hit = router.findHotspot(coord, hs);
        if (hit) sendCashierHotspot(hit);
      }
    }

    router.returnToIdle();
  }, [buildPageCoord, dispatchCoord, restXform, router, sendCashierHotspot, springTo]);

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
        if (!userZoomEnabledRef.current) return;
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
        if (!userZoomEnabledRef.current) return;
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
        const floorS = viewportMinScale(baseScaleRef.current);
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(floorS, current.scale * (nextDist / pinch.prevDist)),
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

  /**
   * 桌面鼠标单击（touch 已由 onEnd→handleTap 处理）。
   * 三区路由与 handleTap 完全对称；缩放态由拖拽覆盖层独占。
   */
  const handleMouseClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (zoomedRef.current) return;
    const coord = buildPageCoord(e.clientX, e.clientY);
    if (!coord) return;

    if (coord.screenRelX < 0.15) {
      pRef.current.onNavigate?.(-2);
    } else if (coord.screenRelX > 0.85) {
      pRef.current.onNavigate?.(2);
    } else {
      dispatchCoord(coord);
    }
  }, [buildPageCoord, dispatchCoord]);

  return (
    <div
      ref={outerRef}
      data-handbook-fs-interaction="1"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        boxSizing: 'border-box',
        touchAction: 'none',
        overscrollBehavior: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'pointer',
        ...style,
      }}
      className={['handbook-fs-interaction-zone', className].filter(Boolean).join(' ')}
      onClick={handleMouseClick}
    >
      <div
        ref={innerRef}
        style={{
          ...(innerFill
            ? {
                position: 'absolute' as const,
                inset: 0,
              }
            : {}),
          transformOrigin: visualTransformOrigin,
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
