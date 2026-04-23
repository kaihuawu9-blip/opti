/**
 * react-pageflip 默认导出在 dynamic + 严格 TS 下会丢失泛型与 ref 类型。
 * 此处用显式契约描述引擎句柄与 props，供 ZeissDigitalHandbook 使用。
 */
import type { CSSProperties, ReactNode } from 'react';

/** 与库内 St/PageFlip 实例对齐的最小可调 API */
export type PageFlipEngine = {
  flip: (page: number) => void;
  getCurrentPageIndex: () => number;
  /** 部分构建版本存在，可选 */
  getPage?: (index: number) => unknown;
};

/** 组件 ref：pageFlip() 返回引擎实例（与现有调用方式一致） */
export type ReactPageFlipRef = {
  pageFlip?: () => PageFlipEngine | undefined;
};

/** 本项目中实际传入 HTMLFlipBook 的 props 子集（其余透传由库忽略） */
export type ReactPageFlipProps = {
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
  onFlip?: (e: { data?: unknown }) => void;
  onInit?: (e: { data?: unknown }) => void;
  onChangeState?: (e: { data?: unknown }) => void;
};
