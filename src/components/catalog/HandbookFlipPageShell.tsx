'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from 'react';
import type { PageFlipEngine } from '@/components/catalog/reactPageFlipTypes';

function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (ref == null) return;
  if (typeof ref === 'function') {
    (ref as (instance: T | null) => void)(node);
  } else {
    (ref as React.MutableRefObject<T | null>).current = node;
  }
}

/** 由 `ZeissDigitalHandbook` 注入：始终从当前 `HTMLFlipBook` ref 取 `pageFlip()`，导航里调 `.flip()` 而非依赖子树重绘 */
const HandbookPageFlipEngineContext = createContext<() => PageFlipEngine | undefined>(() => undefined);

export function HandbookPageFlipEngineProvider({
  getEngine,
  children,
}: {
  getEngine: () => PageFlipEngine | undefined;
  children: ReactNode;
}) {
  const getterRef = useRef(getEngine);
  getterRef.current = getEngine;
  const stableGet = useCallback(() => getterRef.current(), []);
  return (
    <HandbookPageFlipEngineContext.Provider value={stableGet}>{children}</HandbookPageFlipEngineContext.Provider>
  );
}

export function useHandbookPageFlipEngine(): PageFlipEngine | undefined {
  return useContext(HandbookPageFlipEngineContext)();
}

export type HandbookFlipPageShellProps = {
  children: React.ReactNode;
};

/**
 * react-pageflip 的 Page 最外层：单一 DOM ref 供库测量；内层 `handbook-page-container` 显式 `overflow: visible`，
 * 避免蔡司右缘 `right-[-*px]` 物理条被父级裁切（外层链路上仍可能有 `overflow-hidden`，见 `ZeissDigitalHandbook` 与 `page-flip.css`）。
 * 豪雅 / 蔡司物理书签（`ZeissSeriesNavList`）放在本 shell 内 **`relative h-full` 页容器** 中、`absolute` 贴右缘，
 * 且仅全屏双页的**右页**挂载，使 `top:%` 相对**该页渲染高度**计量。
 * 程序化翻页：通过 {@link HandbookPageFlipEngineProvider} + {@link useHandbookPageFlipEngine} 取引擎并调用 `flip()`（有动画），
 * 勿让 `bookCommonPages` 随当前页变引用触发 `updateFromHtml` 打断动画——见 `HandbookFlipRuntimeProvider`。
 */
export const HandbookFlipPageShell = forwardRef<HTMLDivElement, HandbookFlipPageShellProps>(
  function HandbookFlipPageShell({ children }, ref) {
    const shellRef = useRef<HTMLDivElement>(null);
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        shellRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    return (
      <div ref={setRef} data-handbook-flip-shell="1" className="relative h-full w-full min-h-0 !overflow-visible">
        <div
          className="handbook-page-container relative h-full w-full min-h-0"
          style={{ overflow: 'visible' }}
          data-handbook-page-container="1"
        >
          {children}
        </div>
      </div>
    );
  },
);
