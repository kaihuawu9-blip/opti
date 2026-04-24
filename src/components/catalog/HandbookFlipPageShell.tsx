'use client';

import { forwardRef, useCallback, useRef } from 'react';

function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (ref == null) return;
  if (typeof ref === 'function') {
    (ref as (instance: T | null) => void)(node);
  } else {
    (ref as React.MutableRefObject<T | null>).current = node;
  }
}

export type HandbookFlipPageShellProps = {
  children: React.ReactNode;
};

/**
 * react-pageflip 的 Page 最外层：单一 DOM ref，`overflow-visible` 不干扰 3D 动画。
 * 豪雅物理书签（`ZeissSeriesNavList`）应放在本 shell 内 **`relative h-full` 页容器** 中、`absolute` 贴右缘，
 * 且仅全屏双页的**右页**挂载，使 `top:%` 相对**该页渲染高度**计量。
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
      <div
        ref={setRef}
        data-handbook-flip-shell="1"
        className="relative h-full w-full min-h-0 !overflow-visible"
      >
        {children}
      </div>
    );
  },
);
