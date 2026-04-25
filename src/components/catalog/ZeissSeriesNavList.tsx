'use client';

/**
 * StandardEye 4.0：蔡司价目册右缘 rail（硬编码锚点 + 物理公式）；
 * 豪雅 rail 已迁至 {@link HoyaPhysicalTabRail}，本文件不再引用豪雅数据源。
 */

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import type { HandbookSeriesNavItem } from '@/data/zeissHandbookPageMap';
import type { HandbookActiveNavState } from '@/lib/catalog/dataIntegrityValidator';
import { HoyaPhysicalTabRail } from '@/components/catalog/HoyaPhysicalTabRail';
import { useHandbookFlipRuntime } from '@/components/catalog/HandbookFlipRuntimeContext';
import { isHandbookPhysicalRailHostPage } from '@/lib/catalog/handbookPhysicalRailHostPage';

/**
 * 侧栏表面：行内强制（不经过 Tailwind 编译），本帧即生效
 * - slate-900/30 等价 rgba(15, 23, 42, 0.3)（Tailwind slate-900 为 #0f172a，此处用用户指定 RGB）
 */
const ZEISS_NAV_RAIL_SURFACE: CSSProperties = {
  backgroundColor: 'rgba(15, 23, 42, 0.3)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
};

/** 仅结构 / 阴影子类名；背景与模糊一律见 {@link ZEISS_NAV_RAIL_SURFACE} */
const RAIL_CHROME =
  'relative border-l border-white/10 ' +
  'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),inset_-1px_0_12px_rgba(0,0,0,0.2)]';

const NAV_SCROLL_STYLES =
  'zeiss-nav-scroll ' +
  'z-[1] [scrollbar-width:thin] [scrollbar-gutter:stable] ' +
  '[scrollbar-color:rgba(0,30,50,0.3)_rgba(0,0,0,0.1)] ' +
  'hover:[scrollbar-color:rgba(0,59,100,0.5)_rgba(0,0,0,0.2)] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:bg-transparent ' +
  'hover:[&::-webkit-scrollbar]:bg-white/[0.04] ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/[0.1] ' +
  'hover:[&::-webkit-scrollbar-thumb]:bg-[#0066B3]/40';

type NavLayout = 'classic' | 'physical-tabs';

type Props = {
  items: readonly HandbookSeriesNavItem[];
  /** PageFlip 子页 0-based；`physical-tabs` 下须满足 {@link isHandbookPhysicalRailHostPage}（父级已门控，此为双重保险） */
  pageIndex: number;
  /** 未传时从 {@link useHandbookFlipRuntime} 读取（页内 rail，避免牵动 page-flip 子树） */
  activeId?: string;
  onSelect: (item: HandbookSeriesNavItem) => void;
  compact?: boolean;
  className?: string;
  useTwoColumn?: boolean;
  integrityWarnIds?: ReadonlySet<string>;
  activeNav?: HandbookActiveNavState | null;
  brand?: import('@/data/zeissHandbookPageMap').DigitalHandbookBrand;
  navLayout?: NavLayout;
  /** 未传时从 flip runtime context 读取 */
  viewerPdfPage1?: number;
};

function shortLabel(label: string): boolean {
  return label.trim().length <= 10;
}

export function ZeissSeriesNavList({
  items,
  pageIndex,
  activeId,
  onSelect,
  compact = false,
  className = '',
  useTwoColumn: useTwoColProp = true,
  integrityWarnIds,
  activeNav,
  brand = 'zeiss',
  navLayout = 'physical-tabs',
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rt = useHandbookFlipRuntime();
  const activeNavEff = activeNav ?? rt.activeNav ?? null;
  const integrityWarnEff = integrityWarnIds ?? rt.integrityWarnNavIds;
  const activeIdEff =
    (typeof activeId === 'string' && activeId.length > 0 ? activeId : activeNavEff?.anchorId) ?? '';

  const useTwoColumn =
    navLayout === 'classic' && useTwoColProp && !compact && items.length > 6;

  useLayoutEffect(() => {
    if (navLayout === 'physical-tabs') return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-zeiss-nav-active="true"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [activeIdEff, items.length, activeNavEff?.anchorId, activeNavEff?.dataStatus, navLayout]);

  if (navLayout === 'physical-tabs') {
    /** 与 `ZeissDigitalHandbook` 父级 `mountPhysicalRailOnThisPage` 同式，防误挂时的最后一道闸 */
    if (!isHandbookPhysicalRailHostPage(pageIndex)) return null;

    if (brand === 'hoya') {
      return (
        <HoyaPhysicalTabRail
          ref={scrollRef}
          className="zeiss-series-nav-container"
          activeId={activeIdEff}
          onSelect={onSelect}
          integrityWarnIds={integrityWarnEff}
          activeNav={activeNavEff}
        />
      );
    }

    // 蔡司物理标签由 `ZeissDigitalHandbook` 自渲染（书右缘均分铺排）；本组件 zeiss 物理路径已退役。
    if (brand === 'zeiss') return null;

    return null;
  }

  /** 蔡司 classic：页表无已验证凸标时侧栏为空，避免误以为「没渲染」 */
  if (items.length === 0 && brand === 'zeiss' && navLayout === 'classic') {
    return (
      <div
        style={ZEISS_NAV_RAIL_SURFACE}
        className={[
          'relative flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden p-1.5',
          RAIL_CHROME,
          'rounded-r-md border border-dashed border-white/20',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-label="无物理侧栏项"
      >
        <p className="text-center text-[9px] leading-tight text-white/55">
          暂无已验证的物理侧栏
          <span className="mt-0.5 block text-white/40">请核对蔡司页表内凸标与验证字段后刷新本页</span>
        </p>
      </div>
    );
  }

  const labelTextBase = compact
    ? 'line-clamp-4 pl-0.5 text-[10px] font-semibold leading-[1.2] tracking-[-0.02em]'
    : 'line-clamp-3 pl-0.5 text-sm font-medium leading-snug tracking-tight';

  return (
    <div
      style={ZEISS_NAV_RAIL_SURFACE}
      className={[
        'flex h-full min-h-0 w-full flex-1 flex-col',
        RAIL_CHROME,
        'overflow-hidden rounded-r-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        ref={scrollRef}
        role="navigation"
        className={[
          'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
          'flex flex-col',
          NAV_SCROLL_STYLES,
        ].join(' ')}
        aria-label="系列快速跳转"
      >
        <div
          className={
            useTwoColumn
              ? 'grid min-h-0 flex-1 grid-cols-2 content-start items-start gap-1 px-0.5 py-0.5 pr-0.5'
              : 'flex min-h-0 flex-1 flex-col divide-y divide-white/5 px-0.5 py-0.5 pr-0.5'
          }
        >
        {items.map((it) => {
          const active = it.id === activeIdEff;
          const wide = !shortLabel(it.label);
          const integrityWarn = Boolean(integrityWarnEff?.has(it.id));
          const anchorStatus =
            active && activeNavEff && it.id === activeNavEff.anchorId ? activeNavEff.dataStatus : undefined;
          const pendingMsg =
            active && activeNavEff && it.id === activeNavEff.anchorId && activeNavEff.dataStatus === 'warning'
              ? activeNavEff.placeholderMessage
              : '';
          const showDataPending = Boolean(pendingMsg);
          const titleParts = [
            integrityWarn ? '侧栏有此系列，但价目 JSON 中暂无同名 productName' : '',
            anchorStatus === 'validated' ? '价目锚点已通过数据完整性校验' : '',
            anchorStatus === 'warning' ? '当前锚点价目数据待补全' : '',
          ].filter(Boolean);
          return (
            <motion.button
              key={it.id}
              type="button"
              data-zeiss-nav-active={active ? 'true' : undefined}
              data-handbook-anchor-status={anchorStatus}
              title={titleParts.length ? titleParts.join(' · ') : undefined}
              onClick={() => onSelect(it)}
              layout
              initial={false}
              whileHover={{ x: -0.5 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
              style={active ? { borderLeft: '4px solid #005AAA' } : undefined}
              className={[
                'group/btn relative w-full rounded-[2px] pl-0.5 text-left',
                compact ? 'px-0.5 py-px' : 'px-0.5 py-0.5',
                'border-l-4',
                'transition-[background,box-shadow,color,filter] duration-200',
                'border-l-transparent',
                'hover:border-l-white/20',
                useTwoColumn && wide ? 'col-span-2' : 'col-span-1',
                integrityWarn ? 'ring-1 ring-red-500/70 ring-inset' : '',
                active
                  ? 'bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'hover:bg-white/[0.04]',
              ].join(' ')}
            >
              <span
                className={[
                  labelTextBase,
                  active
                    ? 'text-white [text-shadow:0_0_8px_rgba(255,255,255,0.4)]'
                    : 'text-slate-400 group-hover/btn:text-white group-hover/btn:[text-shadow:0_0_8px_rgba(255,255,255,0.4)]',
                ].join(' ')}
              >
                {it.label}
              </span>
              {showDataPending ? (
                <span
                  role="status"
                  className="mt-0.5 block rounded border border-amber-500/40 bg-amber-950/40 px-1 py-0.5 pl-0.5 text-[9px] font-semibold leading-tight text-amber-100/95"
                >
                  {pendingMsg}
                </span>
              ) : null}
            </motion.button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

export { ZeissSeriesNavList as ZeissHandbookNav };