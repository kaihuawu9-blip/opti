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
 * react-pageflip 的 Page 最外层：单一 DOM ref，`overflow-visible` 不干扰 3D 动画；
 * 亚克力索引由整本级 `HandbookAcrylicTabRack` 在 body 层统一绘制。
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
        className="relative h-full w-full min-h-0 overflow-visible"
      >
        {children}
      </div>
    );
  },
);
