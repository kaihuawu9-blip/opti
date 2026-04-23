'use client';

import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Minus, X } from 'lucide-react';

type DraggableRxEditorModalProps = {
  open: boolean;
  onClose: () => void;
  /** 收起为右侧条（−），不关闭编辑状态 */
  onMinimize?: () => void;
  title?: string;
  children: ReactNode;
  maxWidthClassName?: string;
};

/**
 * 验光单二级弹窗：z-[65]、可拖拽、较常规弹窗更高，便于平板填写。
 */
export function DraggableRxEditorModal({
  open,
  onClose,
  onMinimize,
  title,
  children,
  maxWidthClassName = 'max-w-2xl',
}: DraggableRxEditorModalProps) {
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
        <div ref={overlayRef} className="fixed inset-0 z-[65] flex items-center justify-center p-2 sm:p-3 md:p-4">
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
            className={`relative z-10 flex max-h-[min(96dvh,980px)] w-full touch-manipulation flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ${maxWidthClassName}`}
            style={{ pointerEvents: 'auto' }}
          >
            <div
              className="h-2 w-full shrink-0 cursor-grab bg-gradient-to-b from-slate-300/90 to-slate-200/40 active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDrag}
              aria-hidden
            />
            <div
              className="flex shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/95 px-3 py-2.5 active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={startDrag}
            >
              <h2 className="min-w-0 flex-1 truncate text-sm font-bold leading-none text-gray-900">
                {title ?? ' '}
              </h2>
              <div className="flex shrink-0 items-center gap-0.5">
                {onMinimize ? (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMinimize();
                    }}
                    className="cursor-pointer rounded-full p-1.5 hover:bg-gray-200"
                    aria-label="收起至右侧"
                    title="收起至右侧"
                  >
                    <Minus className="h-4 w-4 text-gray-600" />
                  </button>
                ) : null}
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
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
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
