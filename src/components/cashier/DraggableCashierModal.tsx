'use client';

import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

type DraggableCashierModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidthClassName?: string;
};

/**
 * 收银浮层：z-50、可拖拽、默认居中。
 * 约束区与全屏遮罩分离；抓取条 + 标题栏启动 dragControls；正文 stopPropagation 避免抢拖拽。
 */
export function DraggableCashierModal({
  open,
  onClose,
  title,
  children,
  maxWidthClassName = 'max-w-lg',
}: DraggableCashierModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const bump = () => setLayoutEpoch((n) => n + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
    };
  }, [open]);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragControls.start(e);
  };

  return (
    <AnimatePresence>
      {open ? (
        <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 md:p-4">
          {/* 拖拽边界：略缩于视口，避免贴边误触 */}
          <div ref={constraintsRef} className="pointer-events-none absolute inset-2 sm:inset-3" aria-hidden />

          <button
            type="button"
            className="absolute inset-0 z-0 cursor-default bg-black/55"
            onClick={onClose}
            aria-label={title ? `关闭${title}` : '关闭'}
          />

          <motion.div
            key={layoutEpoch}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            layout={false}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragElastic={0.06}
            dragConstraints={constraintsRef}
            className={`relative z-10 flex max-h-[min(92dvh,920px)] w-full touch-manipulation flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ${maxWidthClassName}`}
            style={{ pointerEvents: 'auto' }}
          >
            {/* 顶部抓取条：平板易触达 */}
            <div
              className="h-2 w-full shrink-0 cursor-grab bg-gradient-to-b from-slate-300/90 to-slate-200/40 active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDrag}
              aria-hidden
            />
            <div
              className="flex shrink-0 cursor-grab select-none items-center justify-between border-b border-gray-100 bg-gray-50/95 px-3 py-2 active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDrag}
            >
              <h2 className="text-sm font-bold leading-none text-gray-900">{title ?? ' '}</h2>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="cursor-pointer rounded-full p-1.5 hover:bg-gray-200"
                aria-label="关闭"
              >
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>
            <div
              className="min-h-0 max-h-[min(82dvh,820px)] flex-1 cursor-auto overflow-y-auto overflow-x-hidden overscroll-y-contain"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
