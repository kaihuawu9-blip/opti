'use client';

import { forwardRef, useState } from 'react';

export type ZeissHandbookPageProps = {
  title: string;
  /** 价目 JSON 内嵌 data URL；与 `imageUrl` 二选一优先用本字段 */
  imageData: string | null;
  /** public 路径（如 `/catalog/hoya/p1.jpg`）；无内嵌图时使用 */
  imageUrl?: string | null;
  pageNumber: number;
};

const PAPER_STACK_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.12), inset -2px 0 0 rgba(255,255,255,0.92), inset -5px 0 0 rgba(248,250,252,0.88), inset -9px 0 0 rgba(241,245,249,0.82), inset -13px 0 0 rgba(226,232,240,0.55), inset -16px 0 0 rgba(203,213,225,0.35)';

/**
 * 3D 书页：`imageData`（data URL）优先，否则 `imageUrl`（静态资源）。
 * key 使用 pageNumber 强制每页独立 DOM，避免翻页后纹理/解码残留。
 */
export const ZeissHandbookPage = forwardRef<HTMLDivElement, ZeissHandbookPageProps>(
  function ZeissHandbookPage({ title, imageData, imageUrl, pageNumber }, ref) {
    const [reveal, setReveal] = useState(false);
    const src =
      imageData && imageData.length > 0
        ? imageData
        : imageUrl && imageUrl.length > 0
          ? imageUrl
          : null;

    if (!src) {
      return (
        <div
          ref={ref}
          data-density="compact"
          className="stf__page-root relative h-full w-full overflow-hidden rounded-l-sm border border-white/[0.08] bg-gradient-to-b from-slate-900 to-[#0a0f14]"
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
          key={pageNumber}
          src={src}
          alt={title || `手册第 ${pageNumber} 页`}
          width={1536}
          height={2048}
          loading="eager"
          decoding="sync"
          onLoad={() => setReveal(true)}
          className={[
            'box-border h-full w-full object-contain object-center',
            'transition-opacity ease-out',
            'duration-300',
            reveal ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          draggable={false}
        />
      </div>
    );
  },
);
