'use client';

import type { ReactNode } from 'react';

type SlotProps = { children: ReactNode; className?: string };

/** 槽位为独立函数声明，避免与根布局的 const 初始化顺序产生 TDZ；不在此文件 import 业务模块。 */
function LeftSlotComponent({ children, className = '' }: SlotProps) {
  return (
    <section
      className={`min-h-0 min-w-0 h-auto overflow-visible pr-0 overscroll-contain touch-pan-y xl:h-full xl:overflow-y-auto xl:overflow-x-hidden xl:pr-1 ${className}`}
    >
      {children}
    </section>
  );
}

function MiddleSlotComponent({ children, className = '' }: SlotProps) {
  return (
    <section
      className={`min-h-0 min-w-0 h-auto overflow-visible px-0 overscroll-contain touch-pan-y xl:h-full xl:overflow-y-auto xl:overflow-x-hidden xl:px-1 ${className}`}
    >
      {children}
    </section>
  );
}

function RightSlotComponent({ children, className = '' }: SlotProps) {
  return (
    <aside
      className={`min-h-0 min-w-0 h-auto overflow-visible pl-0 overscroll-contain touch-pan-y xl:h-full xl:overflow-y-auto xl:overflow-x-hidden xl:pl-1 ${className}`}
    >
      {children}
    </aside>
  );
}

type StandardLayoutProps = {
  children: ReactNode;
  className?: string;
  /** 收银台等：仅左 + 右两列，无中间槽 */
  variant?: 'default' | 'cashier-two';
};

function StandardLayoutRoot({ children, className = '', variant = 'default' }: StandardLayoutProps) {
  const xlCols =
    variant === 'cashier-two'
      ? 'xl:grid-cols-[minmax(18rem,28rem)_minmax(17rem,22rem)]'
      : 'xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)_minmax(17rem,22rem)]';
  return (
    <div
      className={`grid h-auto min-h-0 min-w-0 grid-cols-1 gap-4 overflow-x-hidden xl:h-full ${xlCols} ${className}`}
    >
      {children}
    </div>
  );
}

type StandardLayoutCompound = typeof StandardLayoutRoot & {
  LeftSlot: typeof LeftSlotComponent;
  MiddleSlot: typeof MiddleSlotComponent;
  RightSlot: typeof RightSlotComponent;
};

/** 三槽位骨架：用 Object.assign 一次性挂上子组件，引用顺序稳定、无互 import。 */
export const StandardLayout: StandardLayoutCompound = Object.assign(StandardLayoutRoot, {
  LeftSlot: LeftSlotComponent,
  MiddleSlot: MiddleSlotComponent,
  RightSlot: RightSlotComponent,
});
