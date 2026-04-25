'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';

/** 挂在 HTMLFlipBook 外：页内子树用 context 读，避免 `bookCommonPages` 随页变引用导致 page-flip `updateFromHtml` 打断动画 */
export type HandbookFlipRuntimeValue = {
  physicalPdfIndex1: number;
  activeNav: HandbookActiveNavState | null;
  integrityWarnNavIds?: ReadonlySet<string>;
};

const HandbookFlipRuntimeContext = createContext<HandbookFlipRuntimeValue | null>(null);

export function HandbookFlipRuntimeProvider({
  value,
  children,
}: {
  value: HandbookFlipRuntimeValue;
  children: ReactNode;
}) {
  return <HandbookFlipRuntimeContext.Provider value={value}>{children}</HandbookFlipRuntimeContext.Provider>;
}

export function useHandbookFlipRuntime(): HandbookFlipRuntimeValue {
  const v = useContext(HandbookFlipRuntimeContext);
  if (!v) {
    return {
      physicalPdfIndex1: 1,
      activeNav: null,
      integrityWarnNavIds: undefined,
    };
  }
  return v;
}
