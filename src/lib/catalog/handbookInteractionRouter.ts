/**
 * HandbookInteractionRouter — 中央交互事件路由器
 *
 * ─── 设计原则 ─────────────────────────────────────────────────────────────────
 * 1. **纯 TS 类**：不依赖 React，可独立测试。组件通过 `useRef<HandbookInteractionRouter>`
 *    持有实例，生命周期与组件绑定。
 *
 * 2. **状态机**：任何手势输入都要先经过状态机判断，确保互斥性（缩放中不会开启收银等）。
 *
 * 3. **输出端坐标（StandardEye 4.0）**：路由器输出 `PageCoord` 为 **比例语义** ——
 *    视口归一化、跨幅归一化、单页 rel 均由 **实时 getBoundingClientRect 分母** 导出；
 *    **禁止**用固定 CSS 像素常量（如 450）参与点击命中或指纹；热区仍仅用 relX/relY（0–1）。
 *
 * 4. **16ms 节流门**：高频手势（touchmove）调用 `canProcessGesture()` 过门，
 *    返回 false 则丢弃该帧输入（由 rAF 层缓存最新值），确保不阻塞渲染。
 *
 * ─── 状态机 ─────────────────────────────────────────────────────────────────
 *
 *                  ┌──────────────────────────────────────────┐
 *                  │               IDLE                        │
 *                  └──┬──────────┬────────────┬──────────┬────┘
 *            2指start │  1指start│  1指start  │  tap     │  longpress
 *            (always) │  (zoomed)│  (!zoomed) │          │
 *                  ▼  │        ▼ │            │  ▼       │  ▼
 *             ZOOMING  │   PANNING│ [flipbook] │  CASHIER │ LONG_PRESS_FIRED
 *                  │  │        │              │  PENDING │  → IDLE
 *           end2f ─┘  │ end1f ─┘              │  dispatch│
 *                      │                       │  → IDLE  │
 *                      └──────────────────────────────────┘
 *
 * ─── 路由决策矩阵 ──────────────────────────────────────────────────────────────
 *
 * | 手势       | 已缩放？ | cashierMode？ | 命中热区？ | 决策              |
 * |-----------|---------|--------------|----------|------------------|
 * | tap       |  any    |    true      |   yes    | CASHIER          |
 * | tap       |  any    |    true      |   no     | CASHIER_COORD    |
 * | tap       |  yes    |    false     |   —      | ZOOM_RESET       |
 * | tap       |  no     |    false     |   —      | SIDEBAR_TOGGLE   |
 * | long press|  any    |    any       |   yes    | LONG_PRESS(hotspot)|
 * | long press|  any    |    any       |   no     | LONG_PRESS(coord) |
 * | 2-finger  |  any    |    any       |   —      | ZOOM（由 Zone 执行）|
 * | 1-finger  |  yes    |    any       |   —      | PAN（由 Zone 执行）|
 * | 1-finger  |  no     |    any       |   —      | [flipbook 翻页]   |
 */

/* ─── 状态 ─────────────────────────────────────────────────────────────────── */

/**
 * 当前交互模式。
 * - `IDLE`：无活跃手势，等待输入。
 * - `ZOOMING`：双指捏合缩放进行中。
 * - `PANNING`：单指平移进行中（仅放大态）。
 * - `CASHIER_PENDING`：收银事件已路由，等待 bridge 确认完成。
 */
export type InteractionMode = 'IDLE' | 'ZOOMING' | 'PANNING' | 'CASHIER_PENDING';

/* ─── 坐标类型 ──────────────────────────────────────────────────────────────── */

/**
 * StandardEye 4.0 横纵比例语义坐标。
 *
 * 计算路径（无固定 px 分母）：
 *   client → layout 视口（`documentElement.client*`）得 screenRel*；
 *   书槽 `spreadEl.getBoundingClientRect()`（已含祖先 transform）得 spreadRel*；
 *   由 spreadRel* 拆 half → 单页 relX / relY。
 */
export interface PageCoord {
  side:  'left' | 'right';
  /** 单页内相对 X（0.0–1.0） */
  relX:  number;
  /** 单页内相对 Y（0.0–1.0） */
  relY:  number;
  /** 相对 layout 视口宽（`document.documentElement.clientWidth`，与全屏 cover 分母一致） */
  screenRelX: number;
  /** 相对 layout 视口高（`document.documentElement.clientHeight`） */
  screenRelY: number;
  /** 当前跨幅几何框（书槽 bbox）内横向比 [0,1] */
  spreadRelX: number;
  /** 当前跨幅几何框内纵向比 [0,1] */
  spreadRelY: number;
  /**
   * @deprecated 仅兼容旧消费方；恒等于 relX（非 PDF px）。
   * 新逻辑请用 relX / spreadRel* / screenRel*。
   */
  physX: number;
  /** @deprecated 恒等于 relY（非 PDF px）。 */
  physY: number;
}

/* ─── 商品热区 ──────────────────────────────────────────────────────────────── */

/**
 * PDF 页面内预定义的商品热区，坐标系为单页 1:1（0–1）。
 *
 * 数据由 `zeissHandbookPageMap` / 运营配置注入；热区不需要覆盖全页，
 * 未命中热区时路由器退回「广播原始坐标」模式。
 */
export interface ProductHotspot {
  /** 唯一 ID，通常等于 productName */
  id: string;
  /** 热区所在页面侧 */
  side: 'left' | 'right';
  /** 热区中心 X（0–1，单页宽） */
  x: number;
  /** 热区中心 Y（0–1，单页高） */
  y: number;
  /** 热区宽（0–1） */
  w: number;
  /** 热区高（0–1） */
  h: number;
  /** 所在 PDF 物理页（1-based） */
  pdfPage1: number;
  /** 对应商品名（收银 bridge 用） */
  productName?: string;
  /** 子系列提示（可选，供 pickDefaultRow 偏好） */
  subsetHint?: string;
}

/* ─── 路由决策 ──────────────────────────────────────────────────────────────── */

export type RouterDecision =
  /** tap 命中热区 → 触发完整收银流程 */
  | { action: 'CASHIER';        hotspot: ProductHotspot; coord: PageCoord }
  /** tap 未命中热区但 cashierMode → 广播原始坐标 */
  | { action: 'CASHIER_COORD';  coord: PageCoord }
  /** tap 在放大态 → 平滑缩回原位 */
  | { action: 'ZOOM_RESET' }
  /** tap 在原始态 → 通知父级切换侧栏可见性 */
  | { action: 'SIDEBAR_TOGGLE' }
  /** 长按 → 弹出局部信息（商品简述 or 放大镜，由消费方决定） */
  | { action: 'LONG_PRESS'; coord: PageCoord; hotspot: ProductHotspot | null }
  /** 无需外部响应（手势已由 Zone 内部处理，如 pinch/pan） */
  | { action: 'NONE' };

/* ─── 路由器类 ──────────────────────────────────────────────────────────────── */

export class HandbookInteractionRouter {
  private _mode: InteractionMode = 'IDLE';

  /**
   * 节流基准时间（performance.now()），用于 16ms 门控。
   * 每次 canProcessGesture() 返回 true 时更新。
   */
  private _lastGestureMs = 0;

  /**
   * 节流最小间隔（ms）。默认 16ms（约 1 帧）。
   * 调用者可在构造时覆盖以适应不同刷新率。
   */
  readonly minIntervalMs: number;

  constructor(minIntervalMs = 16) {
    this.minIntervalMs = minIntervalMs;
  }

  /* ── 状态读取 ── */

  get mode(): InteractionMode { return this._mode; }

  isIdle():    boolean { return this._mode === 'IDLE'; }
  isZooming(): boolean { return this._mode === 'ZOOMING'; }
  isPanning(): boolean { return this._mode === 'PANNING'; }

  /* ── 状态转移（显式命名，外部调用更具可读性）── */

  enterZooming(): void { this._mode = 'ZOOMING'; }
  enterPanning(): void { this._mode = 'PANNING'; }
  enterCashierPending(): void { this._mode = 'CASHIER_PENDING'; }
  returnToIdle(): void { this._mode = 'IDLE'; }

  /* ── 16ms 节流门 ──────────────────────────────────────────────────────────
   * 在 touchmove 等高频调用链上首先调用。
   * 返回 false 意味着当前帧还不到处理时机，调用方应将最新 Xform 暂存到 pendingRef，
   * 等 rAF 回调统一消费（由 HandbookFsInteractionZone 内的 rAF 层执行）。
   * ────────────────────────────────────────────────────────────────────── */
  canProcessGesture(): boolean {
    if (typeof performance === 'undefined') return true;
    const now = performance.now();
    if (now - this._lastGestureMs < this.minIntervalMs) return false;
    this._lastGestureMs = now;
    return true;
  }

  /* ── 热区命中测试 ──────────────────────────────────────────────────────────
   * 矩形包络测试（热区坐标系 = 单页 0–1）。
   * ────────────────────────────────────────────────────────────────────── */
  findHotspot(
    coord: PageCoord,
    hotspots: readonly ProductHotspot[],
  ): ProductHotspot | null {
    for (const h of hotspots) {
      if (
        h.side === coord.side &&
        Math.abs(coord.relX - h.x) <= h.w / 2 &&
        Math.abs(coord.relY - h.y) <= h.h / 2
      ) {
        return h;
      }
    }
    return null;
  }

  /* ── Tap 路由 ──────────────────────────────────────────────────────────────
   * 决策优先级：热区 > zoom reset > sidebar toggle。
   * cashierMode=true 时始终输出坐标；false 时关注 zoom 状态。
   * ────────────────────────────────────────────────────────────────────── */
  routeTap(params: {
    coord:        PageCoord;
    hotspots:     readonly ProductHotspot[];
    isZoomed:     boolean;
    cashierMode:  boolean;
  }): RouterDecision {
    const { coord, hotspots, isZoomed, cashierMode } = params;
    if (cashierMode) {
      const hit = this.findHotspot(coord, hotspots);
      this.enterCashierPending();
      if (hit) return { action: 'CASHIER', hotspot: hit, coord };
      return { action: 'CASHIER_COORD', coord };
    }
    if (isZoomed) return { action: 'ZOOM_RESET' };
    return { action: 'SIDEBAR_TOGGLE' };
  }

  /* ── 长按路由 ──────────────────────────────────────────────────────────────
   * 长按的 UX 语义由消费方决定（商品简述弹窗 / 局部放大镜均可）。
   * 路由器只负责：命中热区则附带热区信息；否则只给坐标。
   * ────────────────────────────────────────────────────────────────────── */
  routeLongPress(
    coord:    PageCoord,
    hotspots: readonly ProductHotspot[],
  ): RouterDecision {
    const hit = this.findHotspot(coord, hotspots);
    return { action: 'LONG_PRESS', coord, hotspot: hit };
  }

  /* ── 重置（全屏关闭 / 组件卸载时调用）── */
  reset(): void {
    this._mode     = 'IDLE';
    this._lastGestureMs = 0;
  }
}
