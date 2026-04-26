/**
 * react-pageflip 默认导出在 dynamic + 严格 TS 下会丢失泛型与 ref 类型。
 * 此处用显式契约描述引擎句柄与 props，供 ZeissDigitalHandbook 使用。
 */
import type { CSSProperties, ReactNode, Ref } from 'react';

/** page-flip HTML 渲染器 `getRender().getRect()` 与画布模式一致 */
export type PageFlipRenderRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
};

/** 与库内 St/PageFlip 实例对齐的最小可调 API */
export type PageFlipEngine = {
  /** 动画翻向目标页（HTML 模式内部走 flipController） */
  flip: (page: number, corner?: string) => void;
  /** 瞬切到某页（`pages.show`，无翻页动画）— 程序化跳转应优先用 `flip` */
  turnToPage?: (pageIndex: number) => void;
  getCurrentPageIndex: () => number;
  /** 部分构建版本存在，可选 */
  getPage?: (index: number) => unknown;
  /** HTML 模式：用于活页孔等与引擎坐标对齐 */
  getRender?: () => {
    getRect: () => PageFlipRenderRect;
    getOrientation: () => 'landscape' | 'portrait';
  };
};

/** 组件 ref：pageFlip() 返回引擎实例（与现有调用方式一致） */
export type ReactPageFlipRef = {
  pageFlip?: () => PageFlipEngine | undefined;
};

/** 本项目中实际传入 HTMLFlipBook 的 props 子集（其余透传由库忽略） */
export type ReactPageFlipProps = {
  ref?: Ref<ReactPageFlipRef | null>;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  width: number;
  height: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  size?: 'fixed' | 'stretch';
  startPage?: number;
  drawShadow?: boolean;
  maxShadowOpacity?: number;
  showCover?: boolean;
  mobileScrollSupport?: boolean;
  clickEventForward?: boolean;
  useMouseEvents?: boolean;
  swipeDistance?: number;
  flippingTime?: number;
  usePortrait?: boolean;
  startZIndex?: number;
  autoSize?: boolean;
  showPageCorners?: boolean;
  disableFlipByClick?: boolean;
  /** `data` 为当前 0-based 页下标（与 `getCurrentPageIndex()` 一致） */
  onFlip?: (e: { data?: unknown; object?: unknown }) => void;
  onInit?: (e: { data?: unknown }) => void;
  onChangeState?: (e: { data?: unknown }) => void;
  onChangeOrientation?: (e: { data?: unknown }) => void;
};
