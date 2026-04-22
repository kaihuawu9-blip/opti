'use client';

import { forwardRef } from 'react';

export type ZeissHandbookPageProps = {
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  pageNumber: number;
  /** 前若干页 eager + 浏览器预解码 */
  priorityLoad?: boolean;
};

/** 书口「纸张堆叠」白线（物理厚度暗示） */
const PAPER_STACK_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.12), inset -2px 0 0 rgba(255,255,255,0.92), inset -5px 0 0 rgba(248,250,252,0.88), inset -9px 0 0 rgba(241,245,249,0.82), inset -13px 0 0 rgba(226,232,240,0.55), inset -16px 0 0 rgba(203,213,225,0.35)';

/** react-pageflip 要求子节点为可挂 ref 的 DOM；仅渲染 JPEG，等比 contained、禁止拉伸 */
export const ZeissHandbookPage = forwardRef<HTMLDivElement, ZeissHandbookPageProps>(
  function ZeissHandbookPage({ title, imageUrl, pageNumber, priorityLoad }, ref) {
    if (!imageUrl) {
      return (
        <div
          ref={ref}
          data-density="compact"
          className="stf__page-root relative h-full w-full overflow-hidden rounded-l-sm border border-white/10 bg-[#0a0f14]"
        />
      );
    }

    return (
      <div
        ref={ref}
        data-density="compact"
        className="stf__page-root relative h-full w-full overflow-hidden rounded-l-sm border border-white/12 bg-[#0a0f14]"
        style={{ boxShadow: PAPER_STACK_SHADOW }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title || `手册第 ${pageNumber} 页`}
          width={1536}
          height={2048}
          loading={priorityLoad ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priorityLoad ? 'high' : 'auto'}
          className="relative z-10 box-border h-full w-full object-contain object-center"
          draggable={false}
        />
      </div>
    );
  },
);
