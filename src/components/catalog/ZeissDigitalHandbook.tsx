'use client';

import dynamic from 'next/dynamic';
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, ShoppingCart, X } from 'lucide-react';
import '@/styles/page-flip.css';
import { HandbookFlipPageShell } from '@/components/catalog/HandbookFlipPageShell';
import {
  HandbookPhysicalTabColumn,
  buildPhysicalTabColumnItems,
  type PhysicalTabColumnItem,
} from '@/components/catalog/HandbookPhysicalTabColumn';
import { ZeissHandbookPage, type ZeissHandbookPhysicalTabHit } from '@/components/catalog/ZeissHandbookPage';
import { HandbookSidebar } from '@/components/catalog/HandbookSidebar';
import type { ReactPageFlipProps, ReactPageFlipRef } from '@/components/catalog/reactPageFlipTypes';
import { playHandbookPaperRustle } from '@/lib/catalog/handbookPaperSound';
import {
  getPageData,
  buildHandbookSeriesNavItemsForBrand,
  getHandbookPageCount,
  type DigitalHandbookBrand,
  type HandbookNavTabTone,
  type HandbookPageData,
  type HandbookSeriesNavItem,
} from '@/data/zeissHandbookPageMap';
import { embeddedHandbookPageCount } from '@/data/zeissPriceMatrix';
import { ESSILOR_PRICE_MATRIX } from '@/data/essilorPriceMatrix';
import { HOYA_PRICE_MATRIX } from '@/data/hoyaPriceMatrix';
import {
  buildCashierPayloadFromPage,
  dispatchHandbookAddToCart,
} from '@/lib/catalog/handbookCashierBridge';
import {
  defaultIndexAutoCalibrator,
  shouldApplyMatrixPdfFromCalibration,
} from '@/lib/catalog/indexAutoCalibrator';
import type { ZeissHandbookManifest } from '@/lib/catalog/zeissHandbookTypes';
import {
  DATA_INTEGRITY_SESSION_KEY,
  DATA_INTEGRITY_UI_ALERT_VERSION,
  formatDataIntegrityBossSummary,
  getNavIdsMissingMatrixJson,
  getPdfPagesWithMissingMatrixData,
  resolveActiveHandbookNavState,
  runDataIntegrityValidator,
  type HandbookActiveNavState,
} from '@/lib/catalog/dataIntegrityValidator';
import {
  preloadAround,
  preloadHead,
  resetPreloadCache,
} from '@/lib/catalog/handbookImagePreloader';

const HANDBOOK_EMPTY_ACTIVE_NAV: HandbookActiveNavState = { anchorId: '', dataStatus: 'pending' };

/** 物理标签页 Active：右缘约 20% 透明度品牌色（热区高亮，与旧侧栏色系对齐） */
function physicalTabOverlayActiveTint(
  brand: DigitalHandbookBrand,
  tone: HandbookNavTabTone | undefined,
): string {
  const t = tone ?? (brand === 'zeiss' ? 'zeiss-deep-blue' : 'neutral');
  if (brand === 'zeiss' || t === 'zeiss-deep-blue') return 'rgba(0,102,179,0.2)';
  if (t === 'hoya-orange') return 'rgba(194,65,12,0.2)';
  if (t === 'hoya-blue') return 'rgba(3,105,161,0.2)';
  if (t === 'hoya-purple') return 'rgba(109,40,217,0.2)';
  return 'rgba(71,85,105,0.2)';
}

function loadReactPageFlip(): Promise<ComponentType<ReactPageFlipProps>> {
  return import('react-pageflip').then((m) => m.default as ComponentType<ReactPageFlipProps>);
}

const HTMLFlipBook = dynamic(loadReactPageFlip, {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full max-w-2xl items-center justify-center text-sm text-white/50">加载 3D 书引擎…</div>
  ),
});

/** useSyncExternalStore：客户端可安全使用 createPortal，无 useEffect 首帧 setState */
function subscribeNoop(onStoreChange: () => void): () => void {
  void onStoreChange;
  return () => {};
}

/** 成品图为 3:4 人工预裁，3D 纸张比例直接锁定，不做任何动态裁剪推算 */
const PAGE_RATIO_H_OVER_W = 4 / 3;

/** 全屏双页对开：单页高度约 80vh，按 `PAGE_RATIO_H_OVER_W` 计算单页宽度，水平溢出时等比缩放 */
function computeSpreadPageDims(vw: number, vh: number): { pageW: number; pageH: number } {
  const maxPageH = vh * 0.8;
  let pageH = maxPageH;
  let pageW = pageH / PAGE_RATIO_H_OVER_W;
  const spreadW = pageW * 2;
  const maxSpreadW = vw * 0.96;
  if (spreadW > maxSpreadW) {
    const scale = maxSpreadW / spreadW;
    pageW *= scale;
    pageH *= scale;
  }
  return {
    pageW: Math.max(200, Math.floor(pageW)),
    pageH: Math.max(280, Math.floor(pageH)),
  };
}

function formatPageStatusLabel(pdfPage1: number, totalPages: number): string {
  return `第 ${pdfPage1} / 共 ${totalPages} 页`;
}

/**
 * 顶栏/预览页码：与每页底栏「第 N 页」一致，均用**物理序**（= zeissHandbookPageMap 物理页 1..N）。
 * 全屏双页时显示当前跨页范围，如 第 1–2 / 共 82、第 69–70 / 共 82。
 */
function formatHandbookPhysicalLine(
  currentPage0: number,
  totalPages: number,
  twoUpSpread: boolean,
): string {
  const a = currentPage0 + 1;
  if (!twoUpSpread || a >= totalPages) {
    return `第 ${Math.min(a, totalPages)} / 共 ${totalPages}`;
  }
  const b = Math.min(currentPage0 + 2, totalPages);
  return a === b ? `第 ${a} / 共 ${totalPages}` : `第 ${a}–${b} / 共 ${totalPages}`;
}

function BrandSwitcher({
  brand,
  onChange,
  className = '',
  enableEssilor,
  enableHoya,
}: {
  brand: DigitalHandbookBrand;
  onChange: (b: DigitalHandbookBrand) => void;
  className?: string;
  enableEssilor: boolean;
  enableHoya: boolean;
}) {
  const row: { id: DigitalHandbookBrand; name: string; sub: string; disabled?: boolean; primary?: boolean }[] = [
    { id: 'zeiss', name: '蔡司', sub: 'ZEISS', primary: true },
    { id: 'essilor', name: '依视路', sub: 'Essilor', disabled: !enableEssilor },
    { id: 'hoya', name: '豪雅', sub: 'HOYA', disabled: !enableHoya },
  ];
  return (
    <div
      className={[
        'inline-flex items-center gap-0.5 rounded-2xl border border-white/12 bg-black/25 p-0.5 shadow-inner backdrop-blur-md',
        className,
      ].join(' ')}
      role="tablist"
      aria-label="品牌"
    >
      {row.map((b) => {
        const active = !b.disabled && brand === b.id;
        return (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={b.disabled}
            onClick={() => !b.disabled && onChange(b.id)}
            className={[
              'inline-flex min-h-[2rem] min-w-0 flex-col items-center justify-center rounded-[0.9rem] px-2.5 py-0.5 text-[10px] font-semibold transition sm:px-3',
              b.disabled
                ? 'cursor-not-allowed text-white/25 opacity-50'
                : active && b.primary
                  ? 'bg-gradient-to-b from-[#0d4a8c] to-[#083056] text-white shadow-md ring-1 ring-[#2a7fd0]/50'
                  : active
                    ? 'bg-gradient-to-b from-teal-900/45 to-slate-950/55 text-white shadow-md ring-1 ring-teal-400/40'
                    : 'text-white/55 hover:bg-white/5 hover:text-white/80',
            ].join(' ')}
          >
            <span className="text-[12px] leading-tight sm:text-[13px]">{b.name}</span>
            <span className="text-[8px] font-normal uppercase tracking-widest text-white/50">{b.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// MATRIX_PROTOCOL_V1 · 「选定此款并加入收银」悬浮按钮（payload 为 null 时禁用）
function CashierQuickAddButton({
  payload,
  onAdd,
  variant = 'preview',
}: {
  payload: ReturnType<typeof buildCashierPayloadFromPage>;
  onAdd: () => void;
  variant?: 'preview' | 'fullscreen';
}) {
  const enabled = Boolean(payload);
  const [flash, setFlash] = useState(false);
  const label = enabled
    ? `加入收银 · ${payload!.productName}`
    : '本页无价目可加入';
  const compactLabel = enabled ? '加入收银' : '无价目';
  const base =
    variant === 'fullscreen'
      ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur-md transition sm:text-xs'
      : 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md transition';
  const tone = enabled
    ? 'border-emerald-400/40 bg-gradient-to-b from-emerald-500/25 to-emerald-600/20 text-emerald-50 hover:from-emerald-500/35 hover:to-emerald-600/30'
    : 'cursor-not-allowed border-white/10 bg-white/[0.04] text-white/40';
  return (
    <motion.button
      type="button"
      onClick={() => {
        if (!enabled) return;
        onAdd();
        setFlash(true);
        window.setTimeout(() => setFlash(false), 900);
      }}
      disabled={!enabled}
      whileTap={enabled ? { scale: 0.97 } : undefined}
      title={
        enabled
          ? `${payload!.brandLabel} ${payload!.productName} · ${payload!.index} · ${payload!.coating} · ¥${payload!.retailYuan}`
          : '请切到包含价目矩阵的页面'
      }
      className={[base, tone].join(' ')}
      aria-label={label}
    >
      <ShoppingCart className="h-3.5 w-3.5 opacity-90" />
      <span className="whitespace-nowrap">
        {flash ? '已加入 ✓' : compactLabel}
      </span>
      {enabled && payload ? (
        <span className="ml-0.5 tabular-nums text-[10px] text-emerald-100/80">
          ¥{payload.retailYuan}
        </span>
      ) : null}
    </motion.button>
  );
}

// MATRIX_PROTOCOL_V1 · UI 提示文案**一律**来自 getPageData → product，不再散落在各处
function priceMatrixHintForPage(page: HandbookPageData | null): string | null {
  if (!page) return null;
  const product = page.product;
  if (!product) return null;
  const row = product.series[0]?.rows[0];
  if (row && Number.isFinite(row.retailYuan)) {
    return `价目联动 · ${product.productName}（参考起价 ¥${row.retailYuan}，五维矩阵）`;
  }
  return `价目联动 · ${product.productName}`;
}

export function ZeissDigitalHandbook() {
  const shellRef = useRef<HTMLDivElement>(null);
  const previewShellRef = useRef<HTMLDivElement>(null);
  /** 仅包住 HTMLFlipBook 的框，给 ResizeObserver 用，和右侧系列栏同高 */
  const previewBookFrameRef = useRef<HTMLDivElement>(null);
  const fsBookFrameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ReactPageFlipRef>(null);
  const fsRef = useRef<ReactPageFlipRef>(null);
  const modalId = useId();

  const [brand, setBrand] = useState<DigitalHandbookBrand>('zeiss');
  const [dims, setDims] = useState({ w: 520, h: 694 });
  const [fsDims, setFsDims] = useState({ pageW: 480, pageH: 640 });
  const [currentPage, setCurrentPage] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fsEntryPage, setFsEntryPage] = useState(0);
  const [fsSession, setFsSession] = useState(0);
  const [previewResync, setPreviewResync] = useState(0);
  const [previewStart, setPreviewStart] = useState(0);
  /** 3D 书本实际渲染高度（px），与侧栏同高 */
  const [bookVisualH, setBookVisualH] = useState(0);
  const [zeissManifest, setZeissManifest] = useState<ZeissHandbookManifest | null>(null);
  const [dataIntegrityAlertOpen, setDataIntegrityAlertOpen] = useState(false);

  const canPortalFullscreen = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const dataIntegrityGaps = useMemo(
    () => (brand === 'zeiss' ? [...runDataIntegrityValidator()] : []),
    [brand],
  );
  const integrityWarnNavIds = useMemo(
    () => getNavIdsMissingMatrixJson(dataIntegrityGaps),
    [dataIntegrityGaps],
  );
  const integrityMissingMatrixPdfPages = useMemo(
    () => getPdfPagesWithMissingMatrixData(dataIntegrityGaps),
    [dataIntegrityGaps],
  );

  useEffect(() => {
    if (brand !== 'zeiss' || dataIntegrityGaps.length === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const v = sessionStorage.getItem(DATA_INTEGRITY_SESSION_KEY);
        if (v !== DATA_INTEGRITY_UI_ALERT_VERSION) {
          startTransition(() => setDataIntegrityAlertOpen(true));
        }
      } catch {
        startTransition(() => setDataIntegrityAlertOpen(true));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [brand, dataIntegrityGaps.length]);

  useEffect(() => {
    let cancelled = false;
    if (brand === 'zeiss') {
      fetch('/api/catalog/zeiss-manifest/')
        .then((r) => r.json())
        .then((j: { manifest?: ZeissHandbookManifest }) => {
          if (cancelled || !j?.manifest?.pages?.length) return;
          startTransition(() => setZeissManifest(j.manifest!));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    if (brand === 'essilor') {
      fetch('/api/catalog/essilor-manifest/')
        .then((r) => r.json())
        .then((j: { manifest?: ZeissHandbookManifest }) => {
          if (cancelled || !j?.manifest) return;
          startTransition(() => setZeissManifest(j.manifest));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    if (brand === 'hoya') {
      fetch('/api/catalog/hoya-manifest/')
        .then((r) => r.json())
        .then((j: { manifest?: ZeissHandbookManifest }) => {
          if (cancelled || !j?.manifest) return;
          startTransition(() => setZeissManifest(j.manifest));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) startTransition(() => setZeissManifest(null));
    });
    return () => {
      cancelled = true;
    };
  }, [brand]);

  useLayoutEffect(() => {
    const el = fullscreenOpen ? fsBookFrameRef.current : previewBookFrameRef.current;
    if (!el) {
      return;
    }
    // 书框高度变化会牵动 3D 翻页与侧栏；用 startTransition 标记为非紧急，避免与翻页/输入抢同一帧
    const ro = new ResizeObserver((entries) => {
      const h = Math.round(entries[0]?.contentRect?.height ?? 0);
      if (h > 0) startTransition(() => setBookVisualH(h));
    });
    ro.observe(el);
    const first = el.getBoundingClientRect().height;
    if (first > 0) startTransition(() => setBookVisualH(Math.round(first)));
    return () => ro.disconnect();
  }, [
    fullscreenOpen,
    brand,
    dims.w,
    dims.h,
    fsDims.pageW,
    fsDims.pageH,
    previewResync,
    previewStart,
    fsSession,
    fsEntryPage,
  ]);

  // 预览壳尺寸：layout 阶段测量 + startTransition，避免与翻页抢帧、减轻 FOUC
  useLayoutEffect(() => {
    const el = previewShellRef.current;
    if (!el) return;
    const ratioHOverW = PAGE_RATIO_H_OVER_W;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr?.width) return;
      const isNarrow = cr.width < 1280;
      const leftBleed = isNarrow ? 36 : 24;
      const rightRail = isNarrow ? 24 : 200;
      const pad = isNarrow ? 8 : 32;
      const wFromShell = cr.width - pad - leftBleed - rightRail;
      const w = Math.min(680, Math.max(280, wFromShell));
      let h = w * ratioHOverW;
      const maxBookH = Math.min(900, typeof window !== 'undefined' ? window.innerHeight * 0.8 : 640);
      if (h > maxBookH) {
        h = maxBookH;
        const w2 = h / ratioHOverW;
        startTransition(() => setDims({ w: Math.round(w2), h: Math.round(h) }));
        return;
      }
      startTransition(() => setDims({ w: Math.round(w), h: Math.round(h) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 全屏双页尺寸：在浏览器涂色前同步，避免首帧闪跳；resize 时同步更新
  useLayoutEffect(() => {
    if (!fullscreenOpen) return;
    const ro = () => {
      if (typeof window === 'undefined') return;
      const { pageW, pageH } = computeSpreadPageDims(window.innerWidth, window.innerHeight);
      setFsDims({ pageW, pageH });
    };
    ro();
    window.addEventListener('resize', ro);
    return () => window.removeEventListener('resize', ro);
  }, [fullscreenOpen]);

  useEffect(() => {
    if (!fullscreenOpen) {
      document.body.style.overflow = '';
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenOpen]);

  const total = useMemo(() => getHandbookPageCount(brand), [brand]);
  const essilorPagesReady = getHandbookPageCount('essilor') > 0;
  /** Matrix V1.3：豪雅 BRAND_ROW 随页表挂载自动可点，勿写死 disabled */
  const hoyaPagesReady = getHandbookPageCount('hoya') > 0;

  /** 与 bookFrame Ref ResizeObserver 同步；无观测值时回退 dims / 80vh */
  const previewNavHeight = useMemo(() => {
    if (fullscreenOpen) return `${dims.h}px`;
    return bookVisualH > 0 ? `${bookVisualH}px` : `${dims.h}px`;
  }, [bookVisualH, fullscreenOpen, dims.h]);
  const fsNavHeight = useMemo(() => {
    if (!fullscreenOpen) return `min(80vh, ${fsDims.pageH}px)`;
    return bookVisualH > 0 ? `${bookVisualH}px` : `min(80vh, ${fsDims.pageH}px)`;
  }, [bookVisualH, fullscreenOpen, fsDims.pageH]);

  const seriesNav = useMemo(() => buildHandbookSeriesNavItemsForBrand(brand), [brand]);

  /** 插件 B：AnchorID 反查矩阵 + 当前页断层 → dataStatus / 占位文案（状态自愈） */
  const activeNav = useMemo(() => {
    if (total <= 0) return HANDBOOK_EMPTY_ACTIVE_NAV;
    if (brand === 'zeiss') {
      return resolveActiveHandbookNavState(seriesNav, currentPage, dataIntegrityGaps);
    }
    if (brand === 'essilor') {
      return resolveActiveHandbookNavState(seriesNav, currentPage, [], {
        matrixProducts: ESSILOR_PRICE_MATRIX,
      });
    }
    if (brand === 'hoya') {
      return resolveActiveHandbookNavState(seriesNav, currentPage, [], {
        matrixProducts: HOYA_PRICE_MATRIX,
      });
    }
    return HANDBOOK_EMPTY_ACTIVE_NAV;
  }, [brand, total, seriesNav, currentPage, dataIntegrityGaps]);

  const handleBrand = useCallback((b: DigitalHandbookBrand) => {
    if (b === brand) return;
    setBrand(b);
    setCurrentPage(0);
    setPreviewStart(0);
    setPreviewResync((k) => k + 1);
    setFullscreenOpen(false);
  }, [brand]);

  const onFlip = useCallback(
    (e: { data?: unknown }) => {
      const raw = e?.data;
      const next = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(next)) return;
      setCurrentPage(next);
      // 与 pageflip 引擎再对齐一次，避免双页/横排模式下 event 与真实左页下标不同步，导致侧栏高亮与页码偏差
      queueMicrotask(() => {
        const ref = fullscreenOpen ? fsRef : previewRef;
        const pf = ref.current?.pageFlip?.();
        try {
          if (pf && typeof pf.getCurrentPageIndex === 'function') {
            const idx = pf.getCurrentPageIndex();
            if (Number.isFinite(idx)) setCurrentPage(idx);
          }
        } catch {
          /* ignore */
        }
      });
    },
    [fullscreenOpen],
  );

  /** init 的 data 为 { page, mode }，flip 的 data 为 0-based 左页下标 */
  const onBookInit = useCallback(
    (e: { data?: { page?: number; mode?: string } | number }) => {
      const d = e?.data;
      if (d != null && typeof d === 'object' && 'page' in d && typeof d.page === 'number') {
        setCurrentPage(d.page);
      }
      queueMicrotask(() => {
        const ref = fullscreenOpen ? fsRef : previewRef;
        const pf = ref.current?.pageFlip?.();
        try {
          if (pf && typeof pf.getCurrentPageIndex === 'function') {
            const idx = pf.getCurrentPageIndex();
            if (Number.isFinite(idx)) setCurrentPage(idx);
          }
        } catch {
          /* ignore */
        }
      });
    },
    [fullscreenOpen],
  );

  const onChangeState = useCallback((e: { data?: unknown }) => {
    if (e?.data === 'flipping') playHandbookPaperRustle();
  }, []);

  const flipToNavItem = useCallback(
    (item: HandbookSeriesNavItem) => {
      const ref = fullscreenOpen ? fsRef : previewRef;
      const pf = ref.current?.pageFlip?.();
      if (!pf) return;
      try {
        pf.flip(item.startPage0);
      } catch {
        /* ignore */
      }
    },
    [fullscreenOpen],
  );

  const openFullscreen = useCallback(() => {
    setFsEntryPage(currentPage);
    setFsSession((s) => s + 1);
    if (typeof window !== 'undefined') {
      const d = computeSpreadPageDims(window.innerWidth, window.innerHeight);
      setFsDims(d);
    }
    setFullscreenOpen(true);
  }, [currentPage]);

  const closeFullscreen = useCallback(() => {
    const ref = fsRef.current?.pageFlip?.();
    let p = currentPage;
    try {
      if (ref) p = ref.getCurrentPageIndex();
    } catch {
      /* keep currentPage */
    }
    setCurrentPage(p);
    setPreviewStart(p);
    setPreviewResync((k) => k + 1);
    setFullscreenOpen(false);
  }, [currentPage]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenOpen, closeFullscreen]);

  const pageStatusText = useMemo(
    () => (total > 0 ? formatPageStatusLabel(currentPage + 1, total) : ''),
    [currentPage, total],
  );

  /** 翻页物理序（与 3D 左页、内嵌图一致） */
  const physicalPdfIndex1 = total > 0 ? currentPage + 1 : 0;

  /** 插件 A Visual-Text-Anchor：manifest 当前页 URL + 手册标题 → 锁定价目块 pdfIndex */
  const visualTextCalibration = useMemo(() => {
    if (brand !== 'zeiss' || total <= 0 || physicalPdfIndex1 < 1) return null;
    const pd = getPageData(physicalPdfIndex1, 'zeiss');
    const url = zeissManifest?.pages?.[currentPage]?.imageUrl;
    return defaultIndexAutoCalibrator.calibrate({
      pdfIndex1Based: physicalPdfIndex1,
      pageTitle: pd?.title ?? null,
      assetFilename: typeof url === 'string' ? url : null,
    });
  }, [brand, total, currentPage, physicalPdfIndex1, zeissManifest]);

  const matrixContextPdfIndex1 = useMemo(() => {
    if (!visualTextCalibration || !shouldApplyMatrixPdfFromCalibration(visualTextCalibration)) {
      return physicalPdfIndex1;
    }
    return visualTextCalibration.pdfIndex1Based;
  }, [visualTextCalibration, physicalPdfIndex1]);

  // MATRIX_PROTOCOL_V1 · 价目/收银走「校准后」逻辑页；书页贴图仍按物理序由 bookCommonPages 渲染
  const matrixPageData = useMemo<HandbookPageData | null>(
    () => (total > 0 && matrixContextPdfIndex1 >= 1 ? getPageData(matrixContextPdfIndex1, brand) : null),
    [brand, total, matrixContextPdfIndex1],
  );

  const productHint = useMemo(() => priceMatrixHintForPage(matrixPageData), [matrixPageData]);

  const cashierPayload = useMemo(
    () => (matrixPageData ? buildCashierPayloadFromPage(matrixPageData) : null),
    [matrixPageData],
  );

  const integrityPageBroken = useMemo(
    () => brand === 'zeiss' && physicalPdfIndex1 > 0 && integrityMissingMatrixPdfPages.has(physicalPdfIndex1),
    [brand, physicalPdfIndex1, integrityMissingMatrixPdfPages],
  );

  const visualAnchorOverridesPdf = useMemo(
    () =>
      Boolean(
        visualTextCalibration &&
          shouldApplyMatrixPdfFromCalibration(visualTextCalibration) &&
          visualTextCalibration.pdfIndex1Based !== physicalPdfIndex1,
      ),
    [visualTextCalibration, physicalPdfIndex1],
  );

  const handleAddToCashier = useCallback(() => {
    if (!cashierPayload) return;
    dispatchHandbookAddToCart(cashierPayload);
  }, [cashierPayload]);

  const dismissDataIntegrityAlert = useCallback(() => {
    try {
      sessionStorage.setItem(DATA_INTEGRITY_SESSION_KEY, DATA_INTEGRITY_UI_ALERT_VERSION);
    } catch {
      /* ignore private mode */
    }
    setDataIntegrityAlertOpen(false);
  }, []);

  // 勿将 width/height 放入 key：ResizeObserver 会改尺寸，key 变会导致整本 react-pageflip 反复卸载，表现为白屏或「一页没有」
  const previewKey = useMemo(
    () => `pv-${brand}-${previewResync}-${total}-${previewStart}`,
    [brand, previewResync, total, previewStart],
  );

  const fsKey = useMemo(
    () => `fs-${fsSession}-${total}-${fsEntryPage}`,
    [fsSession, total, fsEntryPage],
  );

  const bookCommonPages = useMemo(
    () =>
      Array.from({ length: total }, (_, idx) => {
        const pdfN = idx + 1;
        const pd = getPageData(pdfN, brand);
        const navItem = seriesNav.find(
          (it) =>
            it.physicalTabVerified === true &&
            it.startPage0 === pdfN - 1 &&
            Boolean(it.physicalTabLabel?.trim()),
        );
        const vFromNav =
          typeof navItem?.vOffsetPercent === 'number' && Number.isFinite(navItem.vOffsetPercent)
            ? navItem.vOffsetPercent
            : null;
        const v = vFromNav ?? pd?.vOffsetPercent ?? null;
        const hFromNav =
          typeof navItem?.hOffsetPercent === 'number' && Number.isFinite(navItem.hOffsetPercent)
            ? navItem.hOffsetPercent
            : null;
        const h = hFromNav ?? pd?.hOffsetPercent ?? null;
        const tabLabel = (navItem?.physicalTabLabel ?? navItem?.label ?? '').trim();
        // 双页对开（全屏，`showCover=false` + `usePortrait=false`）：奇数 pdfN 落在左页 → 溢出向左。
        // 预览 portrait 单页：标签永远右溢。
        const side: 'right' | 'left' = fullscreenOpen && pdfN % 2 === 1 ? 'left' : 'right';
        const physicalTabHit: ZeissHandbookPhysicalTabHit | undefined =
          navItem && v != null
            ? {
                vOffsetPercent: v,
                hOffsetPercent: typeof h === 'number' && Number.isFinite(h) ? h : undefined,
                side,
                active: navItem.id === activeNav.anchorId,
                ariaLabel: tabLabel || navItem.id,
                tooltipLabel: tabLabel || navItem.label,
                physicalTabLabel: tabLabel || undefined,
                onSelect: () => flipToNavItem(navItem),
                activeHighlightColor: physicalTabOverlayActiveTint(brand, navItem.navTabTone),
              }
            : undefined;

        const useBodyTabRack = brand === 'hoya' && Boolean(pd?.isManualTrimmed);

        return (
          <HandbookFlipPageShell key={`pg-${brand}-${pdfN}`}>
            <ZeissHandbookPage
              pageNumber={pdfN}
              title={pd?.title ?? `第 ${pdfN} 页`}
              imageData={pd?.imageData ?? null}
              imageUrl={pd?.imageUrl ?? null}
              physicalTabHit={useBodyTabRack ? undefined : physicalTabHit}
              physicalAnchorPage={pd?.physicalAnchorPage ?? false}
              anchorPreservationInsetPct={pd?.anchorPreservationInsetPct ?? null}
              isManualTrimmed={pd?.isManualTrimmed ?? false}
            />
          </HandbookFlipPageShell>
        );
      }),
    [total, brand, seriesNav, activeNav.anchorId, fullscreenOpen],
  );

  /** 豪雅：右侧固定竖向导航 items（仅 physicalTabVerified 项） */
  const physicalTabColumnItems = useMemo<PhysicalTabColumnItem[]>(() => {
    if (brand !== 'hoya') return [];
    return buildPhysicalTabColumnItems(seriesNav);
  }, [brand, seriesNav]);

  const flipToColumnItem = useCallback(
    (it: PhysicalTabColumnItem) => {
      const ref = fullscreenOpen ? fsRef : previewRef;
      const pf = ref.current?.pageFlip?.();
      if (!pf) return;
      try {
        pf.flip(it.startPage0);
      } catch {
        /* ignore */
      }
    },
    [fullscreenOpen],
  );

  useEffect(() => {
    resetPreloadCache();
  }, [brand]);

  useEffect(() => {
    if (brand !== 'hoya' || total <= 0 || typeof window === 'undefined') return;
    const urls = Array.from({ length: total }, (_, idx) => {
      const p = getPageData(idx + 1, 'hoya');
      return p?.imageData ?? p?.imageUrl ?? null;
    });
    preloadHead(urls, 14);
    preloadAround(urls, currentPage, { radius: 6 });
  }, [brand, total, currentPage]);

  if (total === 0) {
    return (
      <div className="relative isolate mx-auto w-full max-w-[min(1400px,calc(100vw-1rem))]">
        <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-gradient-to-br from-[#0059A3]/8 via-transparent to-slate-900/40 blur-3xl" />
        <AnimatePresence mode="wait">
          <motion.div
            key="brand-placeholder"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="relative rounded-2xl border border-white/10 bg-slate-950/35 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <BrandSwitcher
                brand={brand}
                onChange={handleBrand}
                enableEssilor={essilorPagesReady}
                enableHoya={hoyaPagesReady}
              />
              <p className="text-xs text-white/45">多品牌价目与翻页将逐接入</p>
            </div>
            <p className="text-sm text-white/60">
              当前品牌在 <code className="rounded bg-black/30 px-1">HANDBOOK_BRAND_REGISTRY</code> 中尚无物理页表。
              请切换至已挂载手册的品牌（如蔡司、依视路钻晶），或补全该品牌的 <code className="rounded bg-black/30 px-1">*HandbookPageMap</code>。
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  /** 仅依视路：classic 栅格侧栏（蔡司/豪雅已改为页内右缘热区，不再渲染 SeriesNavList） */
  const essilorSeriesNavBlock = (compact: boolean, bookHeightCss: string) => (
    <div
      className="pointer-events-auto flex h-full w-full min-h-0 max-w-[15.5rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.42)] backdrop-blur-2xl"
      style={{ height: bookHeightCss, maxHeight: bookHeightCss }}
    >
      <p className="mb-1 shrink-0 px-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/38">系列索引</p>
      <div className="min-h-0 flex-1 overflow-hidden">
        <HandbookSidebar
          items={seriesNav}
          activeId={activeNav.anchorId}
          activeNav={activeNav}
          onSelect={flipToNavItem}
          compact={compact}
          useTwoColumn={!compact}
          className="h-full"
          integrityWarnIds={integrityWarnNavIds}
          brand={brand}
          navLayout="classic"
        />
      </div>
    </div>
  );

  const spreadGutter = (strong: boolean) => (
    <div
      className="pointer-events-none absolute inset-y-1 left-1/2 z-[120] w-[min(30px,3.5%)] -translate-x-1/2"
      style={{
        background: strong
          ? 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 32%, rgba(0,0,0,0.5) 50%, rgba(255,255,255,0.1) 50.2%, rgba(0,0,0,0.32) 68%, rgba(0,0,0,0) 100%)'
          : 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.14) 38%, rgba(0,0,0,0.28) 50%, rgba(255,255,255,0.07) 50.5%, rgba(0,0,0,0.22) 62%, rgba(0,0,0,0) 100%)',
      }}
      aria-hidden
    />
  );

  const rightPageTurnShade = (className: string) => (
    <div
      className={className}
      style={{
        background:
          'radial-gradient(ellipse 60% 100% at 100% 50%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 42%, transparent 70%)',
      }}
      aria-hidden
    />
  );

  /**
   * 外挂阶梯（Edge Rail）：双页模式下左右各一条，视觉上像纸张边缘「微微凸起的阶梯」，
   * 为页内感应条（`ZeissHandbookPage` 的透明 Hit Layer）提供「物理位」的背景装饰。
   * 不捕获事件、不跟翻页动画 —— 只是舞台道具。
   */
  const edgeRail = (side: 'left' | 'right') => {
    const isLeft = side === 'left';
    const stairs =
      'linear-gradient(90deg, ' +
      (isLeft
        ? 'rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.18) 28%, rgba(255,255,255,0.06) 52%, rgba(0,0,0,0.14) 72%, rgba(0,0,0,0.42) 100%'
        : 'rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.14) 28%, rgba(255,255,255,0.06) 48%, rgba(0,0,0,0.18) 72%, rgba(0,0,0,0.32) 100%') +
      ')';
    return (
      <div
        aria-hidden
        className={[
          'pointer-events-none absolute inset-y-3 z-[5] w-[min(18px,2.4%)]',
          isLeft ? 'left-[-2px]' : 'right-[-2px]',
        ].join(' ')}
        style={{
          background: stairs,
          borderTopLeftRadius: isLeft ? 6 : 0,
          borderBottomLeftRadius: isLeft ? 6 : 0,
          borderTopRightRadius: isLeft ? 0 : 6,
          borderBottomRightRadius: isLeft ? 0 : 6,
          boxShadow: isLeft
            ? 'inset -1px 0 0 rgba(255,255,255,0.08), -2px 0 10px rgba(0,0,0,0.35)'
            : 'inset 1px 0 0 rgba(255,255,255,0.08), 2px 0 10px rgba(0,0,0,0.35)',
        }}
      />
    );
  };

  return (
    <div ref={shellRef} className="relative isolate mx-auto w-full max-w-[min(1400px,calc(100vw-1rem))]">
      <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-gradient-to-br from-[#0059A3]/10 via-transparent to-slate-900/40 blur-3xl" />

      <AnimatePresence mode="wait">
        <motion.div
          key="zeiss-canvas"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className={[
            'relative flex w-full flex-col items-center gap-6',
            brand === 'essilor' ? 'xl:flex-row xl:items-center xl:justify-center xl:gap-8' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
        <div
          ref={previewShellRef}
          className={
            brand === 'essilor'
              ? 'relative w-full max-w-[min(100%,900px)] xl:max-w-[min(100%,720px+11rem)]'
              : 'relative w-full max-w-[min(100%,min(1200px,calc(100vw-1.5rem)))]'
          }
        >
          <div className="mb-2 flex flex-col gap-2 px-1 max-xl:px-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <BrandSwitcher
                brand={brand}
                onChange={handleBrand}
                enableEssilor={essilorPagesReady}
                enableHoya={hoyaPagesReady}
              />
              {total > 0 ? (
                <motion.span
                  key={currentPage}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 1 }}
                  className="text-xs tabular-nums text-white/75"
                >
                  {formatHandbookPhysicalLine(currentPage, total, false)}
                </motion.span>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              <p className="hidden text-xs text-white/50 lg:inline">轻量预览 · 双页对开请用全屏</p>
              <CashierQuickAddButton payload={cashierPayload} onAdd={handleAddToCashier} />
              <button
                type="button"
                onClick={openFullscreen}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white/90 shadow-lg backdrop-blur-md transition hover:bg-white/[0.12]"
              >
                <Maximize2 className="h-3.5 w-3.5 opacity-90" />
                全屏沉浸
              </button>
            </div>
          </div>

          {integrityPageBroken ? (
            <div
              role="alert"
              className="mb-2 rounded-lg border border-red-500/45 bg-red-950/40 px-3 py-2 text-center text-[11px] leading-snug text-red-100/95"
            >
              数据完整性：本物理页在手册中有价目位或系列标题线索，但{' '}
              <code className="rounded bg-black/30 px-1">ZEISS_PRICE_MATRIX</code> 尚未对齐 — Boss，这一页的数据还没填。
            </div>
          ) : null}
          {visualAnchorOverridesPdf ? (
            <div
              className="mb-2 rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-1.5 text-center text-[10px] leading-snug text-amber-100/90"
              title={[
                visualTextCalibration?.matchScore.label,
                visualTextCalibration?.reasons.join(' · '),
              ]
                .filter(Boolean)
                .join(' | ')}
            >
              视觉文本锚点：已按 manifest 文件名 / 标题将价目锁定到「{matrixPageData?.product?.productName ?? matrixPageData?.title ?? '…'}」
              （物理第 {physicalPdfIndex1} 页 → 逻辑 pdfIndex {matrixContextPdfIndex1}）
            </div>
          ) : null}

          <div
            className="group relative"
            title="使用上方「全屏沉浸」进入双页对开；此处可正常翻页"
          >
            <div
              className="pointer-events-none absolute inset-0 z-[3] flex items-end justify-center rounded-xl bg-gradient-to-t from-black/20 via-transparent to-transparent pb-3 opacity-0 transition group-hover:opacity-100"
            >
              <span className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-xs text-white/90 backdrop-blur">
                点顶部「全屏沉浸」双页对开
              </span>
            </div>
            <div
              className="origin-top transition-transform max-xl:scale-[0.98]"
              style={{ perspective: '2200px' }}
            >
              <div
                className="pointer-events-none absolute -bottom-6 left-1/2 z-0 h-20 w-[min(90%,800px)] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.5)_0%,transparent_72%)] opacity-70 blur-2xl"
                aria-hidden
              />
              <div className="relative flex items-stretch justify-center gap-1.5">
              <div
                ref={previewBookFrameRef}
                className="relative z-[15] w-full [filter:drop-shadow(0_20px_40px_rgba(0,0,0,0.45))_drop-shadow(0_6px_18px_rgba(0,89,163,0.1))]"
              >
                {spreadGutter(false)}
                {edgeRail('right')}
                {rightPageTurnShade('pointer-events-none absolute inset-y-2 right-0 z-[100] w-[14%] max-w-[48px] rounded-r-lg')}
                <HTMLFlipBook
                  key={previewKey}
                  ref={previewRef}
                  className="mx-auto"
                  style={{ width: dims.w, minHeight: dims.h }}
                  width={dims.w}
                  height={dims.h}
                  minWidth={260}
                  maxWidth={900}
                  minHeight={360}
                  maxHeight={1200}
                  size="stretch"
                  startPage={previewStart}
                  drawShadow
                  maxShadowOpacity={0.5}
                  showCover={false}
                  mobileScrollSupport
                  clickEventForward
                  useMouseEvents
                  swipeDistance={20}
                  flippingTime={500}
                  usePortrait
                  startZIndex={0}
                  autoSize
                  showPageCorners
                  disableFlipByClick={false}
                  onFlip={onFlip}
                  onInit={onBookInit}
                  onChangeState={onChangeState}
                >
                  {bookCommonPages}
                </HTMLFlipBook>
              </div>
              {brand === 'hoya' && physicalTabColumnItems.length > 0 ? (
                <HandbookPhysicalTabColumn
                  items={physicalTabColumnItems}
                  activeStartPage0={currentPage}
                  heightCss={`${dims.h}px`}
                  onSelect={flipToColumnItem}
                />
              ) : null}
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-white/40">
            {brand === 'essilor'
              ? '翻页时单击书角或拖拽；右侧系列与价目主档、内嵌图与物理页经 getPageData 同步'
              : '翻页时单击书角或拖拽；有物理凸标的页可在画面右缘热区跳转（vOffsetPercent 对齐），价目与物理页经 getPageData 同步'}
          </p>
          {process.env.NODE_ENV === 'development' && brand === 'zeiss' && embeddedHandbookPageCount() === 0 ? (
            <p className="mt-1 text-center text-[10px] text-amber-200/50">
              内嵌图未写入：可运行 <code className="text-white/70">npm run catalog:embed-handbook-to-matrix</code> 将 PDF
              页压入 2026_price_matrix.json
            </p>
          ) : null}
          <p className="mt-1 hidden text-center text-[10px] text-white/35 xl:block">{pageStatusText}</p>
        </div>

        {brand === 'essilor' ? (
          <div
            className="pointer-events-none z-40 flex w-full max-w-[min(100%,16rem)] max-h-[80vh] flex-col items-stretch self-center max-xl:static max-xl:max-w-full max-xl:items-stretch max-xl:px-0 xl:sticky xl:top-6 xl:w-[15.5rem]"
            style={{ height: previewNavHeight, maxHeight: `min(80vh, ${previewNavHeight})`, minHeight: 0 }}
          >
            <div className="pointer-events-auto h-full w-full min-h-0 max-xl:max-w-md">
              {essilorSeriesNavBlock(true, previewNavHeight)}
            </div>
          </div>
        ) : null}
        </motion.div>
      </AnimatePresence>

      {canPortalFullscreen
        ? createPortal(
            <AnimatePresence>
              {fullscreenOpen ? (
                <motion.div
                  key="zeiss-handbook-fullscreen"
                  className="fixed inset-0 z-[300] flex items-center justify-center p-2 sm:p-4"
                  role="dialog"
                  aria-modal
                  aria-labelledby={modalId}
                >
                  <motion.button
                    type="button"
                    aria-label="关闭全屏"
                    className="absolute inset-0 z-0 border-0 bg-black/50 backdrop-blur-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={closeFullscreen}
                  />
                  <motion.button
                    type="button"
                    aria-label="退出全屏"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    onClick={closeFullscreen}
                    className="pointer-events-auto fixed right-4 top-4 z-[400] flex h-14 w-14 items-center justify-center rounded-2xl border border-white/30 bg-slate-950/55 text-white shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl transition hover:bg-slate-900/70 md:right-6 md:top-6"
                  >
                    <X className="h-8 w-8" strokeWidth={2.4} />
                  </motion.button>
                  <motion.div
                    className="relative z-10 flex h-[min(96dvh,100%)] w-[min(98vw,1600px)] max-w-full flex-col items-stretch"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 26, mass: 0.85 }}
                  >
                    <div
                      className="pointer-events-none absolute -inset-3 rounded-[2rem] bg-gradient-to-b from-slate-900/20 to-black/30 blur-2xl"
                      aria-hidden
                    />
                    <div
                      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-slate-950/40 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_32px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
                    >
                      <div className="flex shrink-0 min-w-0 items-center gap-2 border-b border-white/10 bg-black/20 px-3 py-2.5 sm:gap-3 sm:px-5">
                        <p id={modalId} className="sr-only">
                          蔡司价目册全屏预览
                        </p>
                        <BrandSwitcher
                          brand={brand}
                          onChange={handleBrand}
                          className="shrink-0"
                          enableEssilor={essilorPagesReady}
                          enableHoya={hoyaPagesReady}
                        />
                        {total > 0 ? (
                          <motion.span
                            key={currentPage}
                            initial={{ opacity: 0.6 }}
                            animate={{ opacity: 1 }}
                            className="shrink-0 text-xs tabular-nums text-white/85"
                            aria-live="polite"
                          >
                            {formatHandbookPhysicalLine(currentPage, total, true)}
                          </motion.span>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          {productHint ? (
                            <span
                              className="hidden truncate text-[11px] text-emerald-200/80 md:block"
                              title={productHint}
                            >
                              {productHint}
                            </span>
                          ) : null}
                        </div>
                        <CashierQuickAddButton
                          payload={cashierPayload}
                          onAdd={handleAddToCashier}
                          variant="fullscreen"
                        />
                        <button
                          type="button"
                          onClick={closeFullscreen}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg transition hover:bg-white/20"
                          aria-label="关闭"
                        >
                          <X className="h-5 w-5" strokeWidth={2.2} />
                        </button>
                      </div>

                      <div
                        className={
                          brand === 'essilor'
                            ? 'flex min-h-0 flex-1 flex-col items-stretch justify-center gap-3 overflow-hidden p-2 sm:p-3 md:flex-row md:items-stretch md:gap-4 md:p-4'
                            : 'flex min-h-0 flex-1 flex-col items-stretch justify-center overflow-hidden p-2 sm:p-3 md:p-4'
                        }
                      >
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                          {integrityPageBroken ? (
                            <div
                              role="alert"
                              className="shrink-0 rounded-lg border border-red-500/45 bg-red-950/40 px-3 py-2 text-center text-[11px] text-red-100/95"
                            >
                              数据完整性：本物理页价目/标题与 JSON 矩阵断层 — 请先补全价目数据。
                            </div>
                          ) : null}
                          {visualAnchorOverridesPdf ? (
                            <div
                              className="shrink-0 rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-1.5 text-center text-[10px] text-amber-100/90"
                              title={[
                visualTextCalibration?.matchScore.label,
                visualTextCalibration?.reasons.join(' · '),
              ]
                .filter(Boolean)
                .join(' | ')}
                            >
                              视觉文本锚点：价目已对齐至 pdfIndex {matrixContextPdfIndex1}（物理 {physicalPdfIndex1}）
                            </div>
                          ) : null}
                          <div
                            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center [perspective:2400px] max-md:min-h-[48vh]"
                          >
                          {spreadGutter(true)}
                          {rightPageTurnShade(
                            'pointer-events-none absolute inset-y-3 right-2 z-[100] w-[min(8%,64px)] rounded-r-xl md:right-3',
                          )}
                          <div className="relative flex items-stretch justify-center gap-1.5 max-h-[80vh]">
                          <div
                            ref={fsBookFrameRef}
                            className="relative z-[20] w-full max-h-[80vh] [filter:drop-shadow(0_32px_64px_rgba(0,0,0,0.55))]"
                          >
                            {edgeRail('left')}
                            {edgeRail('right')}
                            <HTMLFlipBook
                              key={fsKey}
                              ref={fsRef}
                              className="mx-auto w-full max-w-full"
                              style={{ minHeight: fsDims.pageH, maxHeight: '80vh' }}
                              width={fsDims.pageW}
                              height={fsDims.pageH}
                              minWidth={200}
                              maxWidth={1000}
                              minHeight={240}
                              maxHeight={2000}
                              size="stretch"
                              startPage={fsEntryPage}
                              drawShadow
                              maxShadowOpacity={0.62}
                              showCover={false}
                              mobileScrollSupport
                              clickEventForward
                              useMouseEvents
                              swipeDistance={24}
                              flippingTime={520}
                              usePortrait={false}
                              startZIndex={0}
                              autoSize
                              showPageCorners
                              disableFlipByClick={false}
                              onFlip={onFlip}
                              onInit={onBookInit}
                              onChangeState={onChangeState}
                            >
                              {bookCommonPages}
                            </HTMLFlipBook>
                          </div>
                          {brand === 'hoya' && physicalTabColumnItems.length > 0 ? (
                            <HandbookPhysicalTabColumn
                              items={physicalTabColumnItems}
                              activeStartPage0={currentPage}
                              heightCss={`${fsDims.pageH}px`}
                              onSelect={flipToColumnItem}
                            />
                          ) : null}
                          </div>
                          </div>
                        </div>
                        {brand === 'essilor' ? (
                          <div
                            className="h-full min-h-0 shrink-0 self-stretch pr-0 md:pr-1 md:block"
                            style={{
                              height: fsNavHeight,
                              maxHeight: fsNavHeight,
                              minHeight: 0,
                            }}
                          >
                            {essilorSeriesNavBlock(false, fsNavHeight)}
                          </div>
                        ) : null}
                      </div>
                      <p className="shrink-0 border-t border-white/10 px-4 py-2 text-center text-[10px] text-white/40 md:text-left">
                        {productHint ? (
                          <span className="text-emerald-200/80">{productHint}</span>
                        ) : (
                          '价目主档与物理页、印刷页 P## 的映射见 zeissHandbookPageMap，与价目矩阵 productName 一致。'
                        )}
                      </p>
                    </div>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      {brand === 'zeiss' && dataIntegrityAlertOpen && dataIntegrityGaps.length > 0 ? (
        <motion.div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-black/55 backdrop-blur-sm"
            aria-label="关闭提示"
            onClick={dismissDataIntegrityAlert}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="zeiss-data-integrity-title"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="relative z-10 max-h-[min(82vh,620px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-red-500/45 bg-slate-950/96 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          >
            <h2 id="zeiss-data-integrity-title" className="text-base font-semibold tracking-tight text-red-100">
              价目数据完整性（Data-Integrity-Validator）
            </h2>
            <p className="mt-3 max-h-[48vh] overflow-y-auto whitespace-pre-wrap text-left text-[13px] leading-relaxed text-white/88">
              {formatDataIntegrityBossSummary(dataIntegrityGaps)}
            </p>
            <p className="mt-3 text-[11px] leading-snug text-white/45">
              导航项在 JSON 矩阵中缺同名 productName 时会在数据完整性报告中标出。翻页时红色顶栏：该物理页有价目位或系列标题线索但未绑定矩阵。可在补齐后刷新；点「知道了」后本版本不再弹窗。
            </p>
            <button
              type="button"
              onClick={dismissDataIntegrityAlert}
              className="mt-5 w-full rounded-xl border border-red-400/30 bg-red-600/90 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-red-600"
            >
              知道了
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </div>
  );
}
