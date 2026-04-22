'use client';

import { useEffect, type ReactNode } from 'react';

type AppModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidthClassName?: string;
  zIndexClassName?: string;
  bodyClassName?: string;
  mobilePresentation?: 'auto' | 'center' | 'sheet';
  children: ReactNode;
};

export default function AppModal({
  open,
  onClose,
  title,
  maxWidthClassName = 'max-w-2xl',
  zIndexClassName = 'z-[60]',
  bodyClassName = '',
  mobilePresentation = 'auto',
  children,
}: AppModalProps) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const shellPositionClass =
    mobilePresentation === 'center'
      ? 'items-center justify-center'
      : mobilePresentation === 'sheet'
        ? 'items-end justify-center xl:items-center'
        : 'items-end justify-center xl:items-center';
  const dialogShapeClass =
    mobilePresentation === 'center'
      ? 'rounded-2xl'
      : mobilePresentation === 'sheet'
        ? 'rounded-t-2xl xl:rounded-2xl'
        : 'rounded-t-2xl xl:rounded-2xl';

  return (
    <div className={`fixed inset-0 ${zIndexClassName} flex bg-black/55 p-3 sm:p-4 ${shellPositionClass}`}>
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label={title ? `关闭${title}` : '关闭弹窗'}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${maxWidthClassName} max-h-[min(92dvh,920px)] overflow-hidden border border-gray-200 bg-white shadow-2xl ${dialogShapeClass}`}
      >
        <div className={`min-h-0 max-h-[min(92dvh,920px)] overflow-y-auto overflow-x-hidden ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
