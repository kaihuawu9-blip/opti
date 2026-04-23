'use client';

import { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import { usePathname } from 'next/navigation';
import { useAppNavigate } from '@/lib/useAppNavigate';
import { toChineseErrorMessage } from '@/lib/userMessages';
import { Plus, Pencil, Trash2, Search, Filter, X, AlertTriangle, Upload, Sparkles, Camera, ImageIcon } from 'lucide-react';
import { DraggableCashierModal } from '@/components/cashier/DraggableCashierModal';
import { WebCameraCaptureModal } from '@/components/WebCameraCaptureModal';
import { useAuth } from '@/components/AuthProvider';
import {
  IMPORT_LENS_BRANDS,
  IMPORT_LENS_CATALOG,
  DOMESTIC_LENS_BRANDS,
  DOMESTIC_LENS_CATALOG,
  formatIndex,
  parseLensType,
  type LensBrandKey,
  type LensSeriesOption,
} from '@/lib/lensCatalog';
import { compressImageFileToJpegBlob } from '@/lib/compressImageClient';

type Product = {
  id: string;
  name: string;
  category?: string;
  brand?: string | null;
  model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  price: number;
  stock: number;
  created_at: string;
  allow_discount?: boolean | null;
  allow_points?: boolean | null;
  allow_promo_price?: boolean | null;
  is_hot?: boolean | null;
  is_promo?: boolean | null;
  promo_price?: number | null;
  low_stock_threshold?: number | null;
  refractive_index?: number | null;
  purchase_price?: number | null;
  ocr_evidence_url?: string | null;
};

type StockFilter = 'all' | 'low' | 'out' | 'hot' | 'promo';

type BrandImportParsed = {
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  frame_size?: string | null;
  frame_type: string | null;
  lens_type: string | null;
  price: number;
  stock: number;
  image_url?: string | null;
};

type BrandImportRow = BrandImportParsed & { id: string; selected: boolean };

type MatchProductCandidate = {
  id: string;
  name: string;
  price: number;
  stock: number;
  store_id?: string | null;
};

type BrandImportMatchState = {
  status: 'idle' | 'loading' | 'exact' | 'fuzzy' | 'none' | 'error';
  message?: string;
  matchedProduct?: MatchProductCandidate | null;
  candidates: MatchProductCandidate[];
};

function skuNameForApi(row: BrandImportParsed): string {
  const n = (row.name || '').trim();
  const lt = (row.lens_type || '').trim();
  if (row.category === '镜片' || row.category === '套餐') {
    if (!n && lt) return lt;
    if (n && lt && !n.replace(/\s/g, '').includes(lt.replace(/\s/g, '').slice(0, 12))) {
      return `${n}｜${lt}`;
    }
    if (n) return n;
    return lt || [row.brand, row.model].filter(Boolean).join(' ') || '未命名镜片';
  }
  if (row.category === '镜框') {
    let base = n || [row.brand, row.model, row.frame_size].filter(Boolean).join(' ').trim();
    if (!base) base = '镜框';
    const ft = (row.frame_type || '').trim();
    if (ft && !base.includes(ft)) return `${base} ${ft}`.trim();
    return base;
  }
  if (n) return n;
  return [row.brand, row.model, row.frame_type, lt].filter(Boolean).join(' ').trim() || '未命名SKU';
}

function thresholdFor(p: Product): number {
  const t = Number(p.low_stock_threshold);
  return Number.isFinite(t) && t > 0 ? t : 10;
}

function isNetworkLikeError(msg: string): boolean {
  const t = (msg || '').toLowerCase();
  return t.includes('network request failed') || t.includes('failed to fetch') || t.includes('fetch failed');
}

export default function InventoryPage() {
  const pathname = usePathname();
  const navigate = useAppNavigate();
  const isPackagesRoute = pathname.replace(/\/+$/, '') === '/packages';
  const { hasPermission } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  /** 列表拉取失败或超时（避免云端接口长时间无响应时一直「加载中」） */
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [brandImportOpen, setBrandImportOpen] = useState(false);
  const [brandImportFiles, setBrandImportFiles] = useState<File[]>([]);
  const [brandImportBusy, setBrandImportBusy] = useState(false);
  const [brandImportWriteBusy, setBrandImportWriteBusy] = useState(false);
  const [brandImportTemplateBusy, setBrandImportTemplateBusy] = useState(false);
  const [brandImportErr, setBrandImportErr] = useState<string | null>(null);
  const [brandImportRows, setBrandImportRows] = useState<BrandImportRow[]>([]);
  const [brandImportMatching, setBrandImportMatching] = useState(false);
  const [brandImportMatchMap, setBrandImportMatchMap] = useState<Record<string, BrandImportMatchState>>({});
  const [brandImportMeta, setBrandImportMeta] = useState<{
    truncated?: boolean;
    textLength?: number;
    fileName?: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: '其他',
    brand: '',
    model: '',
    frame_type: '',
    lens_type: '',
    price: '',
    purchase_price: '',
    refractive_index: '',
    stock: '',
    low_stock_threshold: '10',
    is_hot: false,
    is_promo: false,
    promo_price: '',
    allow_discount: true,
    allow_points: true,
    allow_promo_price: true,
  });

  /** 入库 OCR：/api/inventory/ocr 存证图 + 异步回填；采购价/折射率在下方手填 */
  const [inventoryEntryOcrBusy, setInventoryEntryOcrBusy] = useState(false);
  const [inventoryEntryOcrHint, setInventoryEntryOcrHint] = useState<string | null>(null);
  const [inventoryEntryEvidenceUrl, setInventoryEntryEvidenceUrl] = useState<string | null>(null);
  const inventoryEntryGalleryId = useId();
  const inventoryEntryGalleryInputRef = useRef<HTMLInputElement>(null);
  const [inventoryWebCamOpen, setInventoryWebCamOpen] = useState(false);

  useEffect(() => {
    if (!showForm) setInventoryWebCamOpen(false);
  }, [showForm]);

  /** 镜架图上传 OSS（与混元 3D 测试脚本一致：records/admin-frames/&lt;时间戳&gt;_frame.jpg） */
  type FrameUploadMeta = { objectKey: string; imageUrl: string; contentMd5: string };
  const [frameUploadMeta, setFrameUploadMeta] = useState<FrameUploadMeta | null>(null);
  const [frameImageBusy, setFrameImageBusy] = useState(false);
  const [frameImageError, setFrameImageError] = useState<string | null>(null);
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const clearFrameImageUpload = () => {
    setFrameUploadMeta(null);
    setFrameImageError(null);
    setFrameImageBusy(false);
    setFramePreviewUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  async function uploadFrameImageFile(file: File) {
    setFrameImageError(null);
    if (!file.type.startsWith('image/')) {
      setFrameImageError('请选择图片文件（JPEG/PNG 等）');
      return;
    }
    const blobPreview = URL.createObjectURL(file);
    setFramePreviewUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return blobPreview;
    });
    setFrameImageBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/frames/image', { method: 'POST', body: fd });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        data?: { imageUrl?: string; contentMd5?: string; objectKey?: string };
      };
      if (!res.ok || !j?.ok || !j.data?.imageUrl || !j.data?.objectKey) {
        throw new Error(j?.error || `上传失败 HTTP ${res.status}`);
      }
      setFrameUploadMeta({
        objectKey: j.data.objectKey,
        imageUrl: j.data.imageUrl,
        contentMd5: j.data.contentMd5 || '',
      });
      setFramePreviewUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return j.data!.imageUrl!;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFrameImageError(msg);
      setFrameUploadMeta(null);
      setFramePreviewUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setFrameImageBusy(false);
    }
  }

  type InventoryOcrApiJson = {
    ok?: boolean;
    error?: string;
    /** 500 等错误时服务端可能附带的技术说明 */
    message?: string;
    evidenceUrl?: string | null;
    rawText?: string;
    hint?: string;
    result?: {
      brand?: string;
      model?: string;
      size?: string;
      color?: string;
      refractiveIndex?: string;
      suggestedRetailPrice?: number | null;
      referenceCost?: number | null;
    };
  };

  /**
   * 入库 OCR 闭环：先挂存证图（与提交时 ocr_evidence_url 同源）；仅 HTTP 200 且 j.ok 为真时才自动填表。
   * 502/500 等：预览与存证 URL 仍保留，提示错误，不覆盖已手填字段。
   */
  const applyInventoryOcrResponseToForm = useCallback(
    (j: InventoryOcrApiJson, ctx: { httpOk: boolean; httpStatus: number }) => {
      const ev = typeof j.evidenceUrl === 'string' && j.evidenceUrl.trim() ? j.evidenceUrl.trim() : null;
      if (ev) {
        setInventoryEntryEvidenceUrl(ev);
      }

      const hintTrim = typeof j.hint === 'string' ? j.hint.trim() : '';
      const errTrim = typeof j.error === 'string' ? j.error.trim() : '';
      const msgTrim = typeof j.message === 'string' ? j.message.trim() : '';

      const httpFailed = !ctx.httpOk;
      const businessFailed = j.ok !== true;
      if (httpFailed || businessFailed) {
        const fallback =
          !ctx.httpOk && !errTrim && !msgTrim && !hintTrim ? `请求失败 HTTP ${ctx.httpStatus}` : '';
        setInventoryEntryOcrHint(errTrim || msgTrim || hintTrim || fallback || '未知错误');
        return;
      }

      setInventoryEntryOcrHint(null);
      const r = j.result;
      if (!r || typeof r !== 'object') return;
    const brand = String(r.brand ?? '').trim();
    const model = String(r.model ?? '').trim();
    const size = String(r.size ?? '').trim();
    const color = String(r.color ?? '').trim();
    const riAi = String(r.refractiveIndex ?? '').trim();
    const srp = r.suggestedRetailPrice;
    const refCost = r.referenceCost;
    setFormData((prev) => {
      const nameFromAi = [brand, model].filter(Boolean).join(' ').trim();
      const frameBits = [size, color].filter(Boolean).join(' · ').trim();
      let priceNext = prev.price;
      if (!String(prev.price).trim()) {
        if (typeof srp === 'number' && Number.isFinite(srp) && srp >= 0) priceNext = String(srp);
        else if (srp != null && String(srp).trim()) {
          const n = Number(String(srp).replace(/[^\d.]/g, ''));
          if (Number.isFinite(n) && n >= 0) priceNext = String(n);
        }
      }
      let purchaseNext = prev.purchase_price;
      if (!String(prev.purchase_price).trim()) {
        if (typeof refCost === 'number' && Number.isFinite(refCost) && refCost >= 0) purchaseNext = String(refCost);
        else if (refCost != null && String(refCost).trim()) {
          const n = Number(String(refCost).replace(/[^\d.]/g, ''));
          if (Number.isFinite(n) && n >= 0) purchaseNext = String(n);
        }
      }
      let riNext = prev.refractive_index;
      if (!String(prev.refractive_index).trim() && riAi) {
        const n = Number(riAi.replace(/[^\d.]/g, ''));
        riNext = Number.isFinite(n) ? String(n) : riAi;
      }
      return {
        ...prev,
        name: prev.name.trim() ? prev.name : nameFromAi || prev.name,
        brand: prev.brand.trim() ? prev.brand : brand || prev.brand,
        model: prev.model.trim() ? prev.model : model || prev.model,
        frame_type: prev.frame_type.trim() ? prev.frame_type : frameBits || prev.frame_type,
        price: priceNext,
        purchase_price: purchaseNext,
        refractive_index: riNext,
      };
    });
  }, []);

  const processInventoryEntryOcrFile = useCallback(
    async (file: File) => {
      setInventoryEntryOcrBusy(true);
      setInventoryEntryOcrHint(null);
      try {
        const blob = await compressImageFileToJpegBlob(file, { maxBytes: 1_800_000, maxEdge: 2048 });
        const fd = new FormData();
        fd.append('file', blob, 'stock_entry.jpg');
        const res = await fetch('/api/inventory/ocr', { method: 'POST', body: fd });
        const j = (await res.json().catch(() => ({}))) as InventoryOcrApiJson;
        applyInventoryOcrResponseToForm(j, { httpOk: res.ok, httpStatus: res.status });
        if (!res.ok || j.ok !== true) {
          const errLine =
            j.error?.trim() ||
            j.message?.trim() ||
            j.hint?.trim() ||
            (!res.ok ? `HTTP ${res.status}` : '未知错误');
          window.alert('识别中断：' + toChineseErrorMessage(errLine));
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert('入库识别失败：' + toChineseErrorMessage(msg));
      } finally {
        setInventoryEntryOcrBusy(false);
      }
    },
    [applyInventoryOcrResponseToForm],
  );

  // 让下拉在“自定义 + 进口/国产”时仍然能显示选中项
  const lensBrandSelectValue = formData.brand === '自定义' ? (formData.model || '') : '';
  const lensCustomOrigin = formData.brand === '自定义' && (formData.model === '进口' || formData.model === '国产') ? formData.model : '';
  const importLensBrand = lensCustomOrigin === '进口'
    ? IMPORT_LENS_BRANDS.find((b) => (formData.lens_type || '').startsWith(`${b} · `)) ?? ''
    : '';
  const domesticLensBrand = lensCustomOrigin === '国产'
    ? DOMESTIC_LENS_BRANDS.find((b) => (formData.lens_type || '').startsWith(`${b} · `)) ?? ''
    : '';
  const activeLensBrand = (importLensBrand || domesticLensBrand) as LensBrandKey | '';

  const parsedLensType = parseLensType(formData.lens_type || '');
  const parsedIndex = parsedLensType.index;

  const availableSeries: LensSeriesOption[] =
    lensCustomOrigin === '进口' && importLensBrand
      ? IMPORT_LENS_CATALOG[importLensBrand]
      : lensCustomOrigin === '国产' && domesticLensBrand
        ? DOMESTIC_LENS_CATALOG[domesticLensBrand]
        : [];

  // 从 lens_type 的“系列部分”匹配到下拉的 series 文本（尽力匹配）。
  const normalizedSeriesPart =
    activeLensBrand && parsedLensType.seriesPart.startsWith(`${activeLensBrand} · `)
      ? parsedLensType.seriesPart.slice(`${activeLensBrand} · `.length).trim()
      : parsedLensType.seriesPart;

  const matchedSeries = activeLensBrand
    ? availableSeries.find((x) => x.series === normalizedSeriesPart)?.series ?? ''
    : '';

  const matchedIndexStr = parsedIndex !== null && Number.isFinite(parsedIndex) ? formatIndex(parsedIndex) : '';

  /** 镜片与套餐共用镜片下拉/系列逻辑；套餐需同时填写镜框属性与镜片属性 */
  const isLensCategoryForm = formData.category === '镜片' || formData.category === '套餐';

  const PRODUCTS_FETCH_TIMEOUT_MS = 28_000;

  async function fetchProducts() {
    setLoading(true);
    setFetchError(null);
    try {
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), PRODUCTS_FETCH_TIMEOUT_MS);
      const res = await fetch('/api/inventory/products/', { signal: ac.signal });
      clearTimeout(timer);
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: Product[]; error?: string };
      if (!res.ok || !json?.ok) {
        console.warn('[inventory] fetch products:', json?.error || res.status);
        setProducts([]);
        const err = json?.error || '';
        setFetchError(
          err === 'DATABASE_URL_NOT_CONFIGURED'
            ? '服务端未配置 DATABASE_URL，无法读取商品库。'
            : toChineseErrorMessage(err || `HTTP ${res.status}`),
        );
        return;
      }
      setProducts(json.data ?? []);
      setFetchError(null);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.warn('[inventory] fetch products:', e);
      setProducts([]);
      if (raw === 'AbortError' || /aborted/i.test(raw)) {
        setFetchError('加载超时，请检查网络或稍后重试。');
      } else {
        setFetchError(toChineseErrorMessage(raw));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProducts();
  }, []);

  const filteredProducts = useMemo(
    () =>
      products.filter((p) => {
        const byPackage =
          !isPackagesRoute || (p.category || '').trim() === '套餐';
        const bySearch = p.name.toLowerCase().includes(search.toLowerCase());
        const th = thresholdFor(p);
        const byStock =
          stockFilter === 'all' ||
          (stockFilter === 'low' && p.stock > 0 && p.stock < th) ||
          (stockFilter === 'out' && p.stock === 0) ||
          (stockFilter === 'hot' && p.is_hot === true) ||
          (stockFilter === 'promo' && p.is_promo === true);
        return byPackage && bySearch && byStock;
      }),
    [products, search, stockFilter, isPackagesRoute],
  );

  const stockStats = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const p of products) {
      const th = thresholdFor(p);
      if (p.stock === 0) out += 1;
      else if (p.stock > 0 && p.stock < th) low += 1;
    }
    return { low, out, total: products.length };
  }, [products]);

  const resetForm = () => {
    clearFrameImageUpload();
    setInventoryEntryOcrBusy(false);
    setInventoryEntryOcrHint(null);
    setInventoryEntryEvidenceUrl(null);
    setFormData({
      name: '',
      category: '其他',
      brand: '',
      model: '',
      frame_type: '',
      lens_type: '',
      price: '',
      purchase_price: '',
      refractive_index: '',
      stock: '',
      low_stock_threshold: '10',
      is_hot: false,
      is_promo: false,
      promo_price: '',
      allow_discount: true,
      allow_points: true,
      allow_promo_price: true,
    });
    setEditingProduct(null);
    setShowForm(false);
  };

  const openBrandImportModal = () => {
    setBrandImportFiles([]);
    setBrandImportErr(null);
    setBrandImportRows([]);
    setBrandImportMatching(false);
    setBrandImportMatchMap({});
    setBrandImportMeta(null);
    setBrandImportOpen(true);
  };

  const closeBrandImportModal = () => {
    if (brandImportBusy || brandImportWriteBusy || brandImportTemplateBusy) return;
    setBrandImportOpen(false);
  };

  async function matchSingleImportRow(row: BrandImportRow): Promise<BrandImportMatchState> {
    try {
      const text = [row.name, row.lens_type, row.frame_type].filter(Boolean).join(' ');
      const res = await fetch('/api/ai/match-product/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          keywords: {
            name: row.name || undefined,
            brand: row.brand || undefined,
            model: row.model || undefined,
          },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        matchType?: 'exact' | 'fuzzy' | 'none';
        product?: MatchProductCandidate | null;
        candidates?: MatchProductCandidate[];
      };
      if (!res.ok || !j.ok) {
        throw new Error(j.error || `匹配失败 HTTP ${res.status}`);
      }
      if (j.matchType === 'exact' && j.product) {
        return {
          status: 'exact',
          message: `已自动匹配标准库商品：${j.product.name}`,
          matchedProduct: j.product,
          candidates: [],
        };
      }
      if (j.matchType === 'fuzzy' && Array.isArray(j.candidates) && j.candidates.length > 0) {
        return {
          status: 'fuzzy',
          message: '找到多个候选，请点选其一。',
          matchedProduct: null,
          candidates: j.candidates.slice(0, 3),
        };
      }
      return {
        status: 'none',
        message: '库中无此型号，是否作为新商品入库？',
        matchedProduct: null,
        candidates: [],
      };
    } catch (e) {
      return {
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        matchedProduct: null,
        candidates: [],
      };
    }
  }

  async function autoMatchImportedRows(rows: BrandImportRow[]) {
    if (rows.length === 0) return;
    setBrandImportMatching(true);
    setBrandImportMatchMap((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        next[r.id] = { status: 'loading', message: '正在匹配标准库商品...', matchedProduct: null, candidates: [] };
      });
      return next;
    });
    try {
      const settled = await Promise.all(rows.map(async (r) => ({ id: r.id, match: await matchSingleImportRow(r) })));
      setBrandImportMatchMap((prev) => {
        const next = { ...prev };
        for (const item of settled) {
          next[item.id] = item.match;
        }
        return next;
      });
      const exactMap = new Map<string, MatchProductCandidate>();
      for (const item of settled) {
        if (item.match.status === 'exact' && item.match.matchedProduct) {
          exactMap.set(item.id, item.match.matchedProduct);
        }
      }
      if (exactMap.size > 0) {
        setBrandImportRows((prev) =>
          prev.map((r) => {
            const hit = exactMap.get(r.id);
            if (!hit) return r;
            return {
              ...r,
              selected: true,
              name: hit.name || r.name,
              price: Number.isFinite(Number(hit.price)) ? Number(hit.price) : r.price,
            };
          }),
        );
      }
    } finally {
      setBrandImportMatching(false);
    }
  }

  const runBrandImportAi = async () => {
    if (brandImportFiles.length === 0) {
      window.alert('请先选择文件（支持 PDF / xlsx / pptx / 图片，可多选）');
      return;
    }
    setBrandImportBusy(true);
    setBrandImportErr(null);
    try {
      const fd = new FormData();
      const sorted = [...brandImportFiles].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      sorted.forEach((f) => fd.append('files', f));
      if (sorted[0]) fd.append('file', sorted[0]);
      const res = await fetch('/api/inventory/import/', { method: 'POST', body: fd });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: {
          items: BrandImportParsed[];
          truncated?: boolean;
          textLength?: number;
          fileName?: string;
        };
      };
      if (!res.ok || !j.ok || !j.data?.items) {
        throw new Error(j.error || `请求失败 HTTP ${res.status}`);
      }
      setBrandImportMeta({
        truncated: j.data.truncated,
        textLength: j.data.textLength,
        fileName: j.data.fileName,
      });
      const parsedRows = j.data.items.map((it) => ({
        ...it,
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        selected: true,
      }));
      setBrandImportRows(parsedRows);
      void autoMatchImportedRows(parsedRows);
      if (j.data.items.length === 0) {
        window.alert('AI 未识别到商品行，可换更清晰价目表或稍后在表格中手工补充。');
      }
    } catch (e) {
      setBrandImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrandImportBusy(false);
    }
  };

  const patchBrandImportRow = (id: string, patch: Partial<BrandImportParsed>) => {
    setBrandImportRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const applyBrandImportCandidate = (id: string, candidate: MatchProductCandidate) => {
    setBrandImportRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              selected: true,
              name: candidate.name || r.name,
              price: Number.isFinite(Number(candidate.price)) ? Number(candidate.price) : r.price,
            }
          : r,
      ),
    );
    setBrandImportMatchMap((prev) => ({
      ...prev,
      [id]: {
        status: 'exact',
        message: `已自动匹配标准库商品：${candidate.name}`,
        matchedProduct: candidate,
        candidates: [],
      },
    }));
  };

  const toggleBrandImportRow = (id: string) => {
    setBrandImportRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  };

  const writeBrandImportToInventory = async () => {
    const rows = brandImportRows.filter((r) => r.selected);
    if (rows.length === 0) {
      window.alert('请至少勾选一条记录');
      return;
    }
    setBrandImportWriteBusy(true);
    setBrandImportErr(null);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    try {
      for (const r of rows) {
        const name = skuNameForApi(r);
        if (!name.trim()) {
          fail += 1;
          continue;
        }
        try {
          const res = await fetch('/api/inventory/products/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              price: r.price,
              stock: r.stock,
            }),
          });
          const jr = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (res.ok && jr.ok) ok += 1;
          else {
            fail += 1;
            errors.push(`${name}: ${jr.error || res.status}`);
          }
        } catch (err) {
          fail += 1;
          errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      void fetchProducts();
      if (fail === 0) {
        window.alert(`已成功写入 ${ok} 条 SKU。`);
        setBrandImportOpen(false);
        setBrandImportRows([]);
      } else {
        window.alert(
          `完成：成功 ${ok} 条，失败 ${fail} 条。${errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''}`,
        );
      }
    } finally {
      setBrandImportWriteBusy(false);
    }
  };

  const writeBrandImportToTemplate = async () => {
    const rows = brandImportRows.filter((r) => r.selected);
    if (rows.length === 0) {
      window.alert('请至少勾选一条记录');
      return;
    }
    setBrandImportTemplateBusy(true);
    try {
      const key = 'brand_import_templates_v1';
      const current = JSON.parse(window.localStorage.getItem(key) || '[]') as Array<{
        id: string;
        name: string;
        createdAt: string;
        sourceFile: string;
        rows: BrandImportParsed[];
      }>;
      const now = new Date();
      const payload = {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        name: `模板_${now.toISOString().slice(0, 10)}_${String(current.length + 1).padStart(2, '0')}`,
        createdAt: now.toISOString(),
        sourceFile: brandImportMeta?.fileName || '多文件导入',
        rows: rows.map((r) => ({
          category: r.category,
          name: r.name,
          brand: r.brand,
          model: r.model,
          frame_type: r.frame_type,
          lens_type: r.lens_type,
          price: r.price,
          stock: r.stock,
        })),
      };
      window.localStorage.setItem(key, JSON.stringify([payload, ...current]));
      window.alert(
        `已写入模板（${rows.length} 条）。镜框型号/尺寸/图片来源会一并保留，收银台可直接使用说明。`,
      );
    } finally {
      setBrandImportTemplateBusy(false);
    }
  };

  const openCreateForm = () => {
    clearFrameImageUpload();
    setEditingProduct(null);
    setInventoryEntryOcrBusy(false);
    setInventoryEntryOcrHint(null);
    setInventoryEntryEvidenceUrl(null);
    setFormData({
      name: '',
      category: isPackagesRoute ? '套餐' : '其他',
      brand: '',
      model: '',
      frame_type: '',
      lens_type: '',
      price: '',
      purchase_price: '',
      refractive_index: '',
      stock: '',
      low_stock_threshold: '10',
      is_hot: false,
      is_promo: false,
      promo_price: '',
      allow_discount: true,
      allow_points: true,
      allow_promo_price: true,
    });
    setShowForm(true);
  };

  const openEditForm = (product: Product) => {
    clearFrameImageUpload();
    setEditingProduct(product);
    const isLens =
      (product.category || '').trim() === '镜片' ||
      (product.category || '').trim() === '套餐' ||
      Boolean(product.lens_type);
    const isLegacyCustomOrigin = isLens && (product.brand === '进口' || product.brand === '国产');
    const isCustomSplitOrigin = isLens && product.brand === '自定义' && (product.model === '进口' || product.model === '国产');
    const brand = isLegacyCustomOrigin ? '自定义' : product.brand || '';
    const model = isLegacyCustomOrigin ? product.brand || '' : isCustomSplitOrigin ? product.model || '' : product.model || '';
    setFormData({
      name: product.name,
      category: product.category || '其他',
      brand,
      model,
      frame_type: product.frame_type || '',
      lens_type: product.lens_type || '',
      price: String(product.price),
      purchase_price:
        product.purchase_price != null && Number.isFinite(Number(product.purchase_price))
          ? String(product.purchase_price)
          : '',
      refractive_index:
        product.refractive_index != null && Number.isFinite(Number(product.refractive_index))
          ? String(product.refractive_index)
          : '',
      stock: String(product.stock),
      low_stock_threshold: String(thresholdFor(product)),
      is_hot: product.is_hot === true,
      is_promo: product.is_promo === true,
      promo_price: product.promo_price != null ? String(product.promo_price) : '',
      allow_discount: product.allow_discount !== false,
      allow_points: product.allow_points !== false,
      allow_promo_price: product.allow_promo_price !== false,
    });
    setInventoryEntryEvidenceUrl(
      typeof product.ocr_evidence_url === 'string' && product.ocr_evidence_url.trim()
        ? product.ocr_evidence_url.trim()
        : null,
    );
    setInventoryEntryOcrHint(null);
    setShowForm(true);
  };

  const setLensPreset = (origin: '进口' | '国产', brandName: LensBrandKey, series: string, index: number) => {
    // 数据不改库结构：brand='自定义'，model='进口/国产'，lens_type 写品牌+系列+折射率。
    setFormData((prev) => ({
      ...prev,
      brand: '自定义',
      model: origin,
      lens_type: `${brandName} · ${series} / ${formatIndex(index)}`,
    }));
  };

  const handleSubmit = async () => {
    const name = formData.name.trim();
    const category = formData.category || '其他';
    const brand = formData.brand.trim() || null;
    const model = formData.model.trim() || null;
    const frame_type = formData.frame_type.trim() || null;
    const lensOnly = category === '镜片' || category === '套餐';
    const lens_type = lensOnly ? formData.lens_type.trim() || null : null;
    const price = Number(formData.price);
    const stock = Number(formData.stock);
    const low_stock_threshold = Number.parseInt(String(formData.low_stock_threshold).trim(), 10);
    const promoRaw = formData.promo_price.trim();
    const promoNum = promoRaw === '' ? null : Number(promoRaw);

    if (!name) {
      window.alert('请输入商品名称');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      window.alert('请输入正确的零售价');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      window.alert('请输入正确的库存整数');
      return;
    }
    if (!Number.isInteger(low_stock_threshold) || low_stock_threshold < 0) {
      window.alert('低库存预警阈值需为大于等于 0 的整数');
      return;
    }
    if (formData.is_promo) {
      if (promoNum === null || Number.isNaN(promoNum) || promoNum < 0) {
        window.alert('勾选特价后请填写有效的特价金额');
        return;
      }
    }

    const purchaseRaw = formData.purchase_price.trim();
    let purchase_price: number | null = null;
    if (purchaseRaw !== '') {
      const pp = Number(purchaseRaw);
      if (Number.isNaN(pp) || pp < 0) {
        window.alert('采购价需为非负数字，或留空');
        return;
      }
      purchase_price = pp;
    }

    const riRaw = formData.refractive_index.trim();
    let refractive_index: number | null = null;
    if (riRaw !== '') {
      const ri = Number(riRaw);
      if (Number.isNaN(ri)) {
        window.alert('折射率需为数字（如 1.67），或留空');
        return;
      }
      refractive_index = ri;
    }

    const evUrl = inventoryEntryEvidenceUrl?.trim() || '';

    const retailPayload = {
      low_stock_threshold,
      is_hot: formData.is_hot,
      is_promo: formData.is_promo,
      promo_price: formData.is_promo && promoNum !== null && !Number.isNaN(promoNum) ? promoNum : null,
      allow_discount: formData.allow_discount,
      allow_points: formData.allow_points,
      allow_promo_price: formData.allow_promo_price,
      purchase_price,
      refractive_index,
      ocr_evidence_url: evUrl || null,
    };

    const payload = { name, category, brand, model, frame_type, lens_type, price, stock, ...retailPayload };
    setSubmitting(true);
    try {
      // 优先走同源 API（服务端写库），避免前端直连云端 REST 在平板/弱网下频繁失败。
      const method = editingProduct ? 'PUT' : 'POST';
      const body = editingProduct ? { id: editingProduct.id, ...payload } : payload;
      const apiResp = await fetch('/api/inventory/products/', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const apiJson = await apiResp.json().catch(() => ({}));
      if (apiResp.ok && apiJson?.ok) {
        const guard = (apiJson as { matrix_inventory_guard?: { status?: string; reasons?: string[] } })
          .matrix_inventory_guard;
        if (guard?.status === 'suggest_review' && Array.isArray(guard.reasons) && guard.reasons.length > 0) {
          window.alert(`存疑入库提示（已保存）：\n${guard.reasons.join('\n')}`);
        }
        resetForm();
        void fetchProducts();
        return;
      }
      if (apiJson?.error === 'DATABASE_URL_NOT_CONFIGURED') {
        window.alert('保存失败：服务端未配置 DATABASE_URL（PostgreSQL 连接串）。');
        return;
      }
      window.alert(
        '保存失败：' + toChineseErrorMessage(String(apiJson?.error || (apiResp.ok ? '' : `HTTP ${apiResp.status}`))),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNetworkLikeError(msg)) {
        const method = editingProduct ? 'PUT' : 'POST';
        const body = editingProduct ? { id: editingProduct.id, ...payload } : payload;
        const resp = await fetch('/api/inventory/products/', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.ok) {
          if (json?.error === 'DATABASE_URL_NOT_CONFIGURED') {
            window.alert('保存失败：服务端未配置 DATABASE_URL（PostgreSQL 连接串）。');
            return;
          }
          window.alert('保存失败：' + toChineseErrorMessage(json?.error || msg));
        } else {
          const guard = (json as { matrix_inventory_guard?: { status?: string; reasons?: string[] } })
            .matrix_inventory_guard;
          if (guard?.status === 'suggest_review' && Array.isArray(guard.reasons) && guard.reasons.length > 0) {
            window.alert(`存疑入库提示（已保存）：\n${guard.reasons.join('\n')}`);
          }
          resetForm();
          void fetchProducts();
        }
      } else {
        window.alert('保存失败：' + toChineseErrorMessage(msg));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('确定要删除这个商品吗？')) return;
    try {
      const res = await fetch(`/api/inventory/products/?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        const msg =
          json?.error === 'DATABASE_URL_NOT_CONFIGURED'
            ? '服务端未配置 DATABASE_URL（PostgreSQL 连接串）。'
            : toChineseErrorMessage(json?.error || `HTTP ${res.status}`);
        window.alert('删除失败：' + msg);
        return;
      }
      void fetchProducts();
    } catch (e) {
      window.alert('删除失败：' + toChineseErrorMessage(e instanceof Error ? e.message : String(e)));
    }
  };

  const cycleStockFilter = () => {
    setStockFilter((prev) => {
      if (prev === 'all') return 'low';
      if (prev === 'low') return 'out';
      if (prev === 'out') return 'hot';
      if (prev === 'hot') return 'promo';
      return 'all';
    });
  };

  if (loading) return <div className="flex justify-center items-center h-64">加载中...</div>;
  if (!hasPermission('inventory.view')) {
    return (
      <div className="text-gray-600">
        当前账号无权访问{isPackagesRoute ? '套餐管理' : '库存管理'}。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 max-w-full flex-col overflow-hidden overscroll-contain">
      <div className="shrink-0 space-y-4 pb-4">
        {fetchError ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3"
            role="alert"
          >
            <span>{fetchError}</span>
            <button
              type="button"
              onClick={() => void fetchProducts()}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700"
            >
              重新加载
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">
              {isPackagesRoute ? '套餐管理' : '库存管理'}
            </h1>
            {isPackagesRoute ? (
              <button
                type="button"
                onClick={() => navigate('/inventory')}
                className="text-sm text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
              >
                查看全部库存
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isPackagesRoute ? (
              <button
                type="button"
                onClick={openBrandImportModal}
                className="flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors shadow-md"
              >
                <Upload className="w-5 h-5 mr-1" /> 新增品牌
              </button>
            ) : null}
            <button
              onClick={openCreateForm}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md"
            >
              <Plus className="w-5 h-5 mr-1" /> {isPackagesRoute ? '新增套餐' : '新增商品'}
            </button>
          </div>
        </div>

        {(stockStats.low > 0 || stockStats.out > 0) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 flex flex-wrap items-center gap-3 text-sm text-amber-950">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              全店共 <strong>{stockStats.total}</strong> 个 SKU：
              {stockStats.out > 0 && (
                <>
                  {' '}
                  <strong className="text-red-700">{stockStats.out}</strong> 个缺货
                </>
              )}
              {stockStats.low > 0 && (
                <>
                  {stockStats.out > 0 ? '，' : ' '}
                  <strong className="text-amber-800">{stockStats.low}</strong> 个低于各自预警阈值
                </>
              )}
              。可在列表「库存」列查看，并在商品编辑里调整预警线。
            </span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="shrink-0 border-b border-gray-100 p-4 flex flex-col md:flex-row justify-between md:items-center gap-3 md:space-x-4">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索商品名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={cycleStockFilter}
            className="flex items-center px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Filter className="w-4 h-4 mr-1" /> 筛选
          </button>
        </div>
        <div className="shrink-0 border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
          当前筛选：
          {isPackagesRoute ? ' 分类「套餐（镜框+镜片）」；' : ''}
          {stockFilter === 'all' && ' 全部'}
          {stockFilter === 'low' && ' 低库存（低于各商品预警线且 &gt;0）'}
          {stockFilter === 'out' && ' 缺货(=0)'}
          {stockFilter === 'hot' && ' 热卖'}
          {stockFilter === 'promo' && ' 特价'}
        </div>

        <div className="min-h-0 flex-1 max-h-[calc(100dvh-17rem)] overflow-y-auto overflow-x-auto overscroll-y-contain touch-pan-y">
          <table className="w-full table-fixed border-collapse text-left text-sm text-gray-700">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600 text-xs font-semibold shadow-[0_1px_0_0_rgb(243_244_246)]">
              <tr>
                <th className="max-xl:w-[40%] px-3 py-3 font-semibold xl:w-[22%]">商品名称</th>
                <th className="hidden px-3 py-3 font-semibold xl:table-cell xl:w-[12%]">标记</th>
                <th className="px-3 py-3 font-semibold max-xl:w-[28%] xl:w-[18%]">分类/规格</th>
                <th className="hidden px-3 py-3 font-semibold xl:table-cell xl:w-[10%]">类型</th>
                <th className="px-3 py-3 font-semibold xl:w-[9%]">价格 (￥)</th>
                <th className="px-3 py-3 font-semibold xl:w-[11%]">库存 / 预警</th>
                <th className="hidden px-3 py-3 font-semibold xl:table-cell xl:w-[10%]">最后更新</th>
                <th className="max-xl:sticky max-xl:right-0 max-xl:z-[11] max-xl:bg-gray-50 max-xl:pl-1 max-xl:shadow-[-10px_0_14px_-10px_rgba(15_23_42/0.18)] px-3 py-3 text-right font-semibold xl:w-[8%] xl:shadow-none">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map((product) => {
                const th = thresholdFor(product);
                const isWarnRow = product.stock < th;
                const actionCellBg = isWarnRow ? 'max-xl:bg-orange-50/95' : 'max-xl:bg-white';
                return (
                  <tr
                    key={product.id}
                    className={`transition-colors ${
                      isWarnRow ? 'bg-orange-50/60 hover:bg-orange-50/85' : 'hover:bg-gray-50/90'
                    }`}
                  >
                    <td className="px-3 py-3 font-medium text-gray-900 align-middle">{product.name}</td>
                    <td className="hidden px-3 py-3 text-xs align-middle xl:table-cell">
                      {product.is_hot ||
                      product.is_promo ||
                      product.allow_discount === false ||
                      product.allow_points === false ? (
                        <div className="flex flex-wrap gap-1">
                          {product.is_hot ? (
                            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-800">热卖</span>
                          ) : null}
                          {product.is_promo ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">特价</span>
                          ) : null}
                          {product.allow_discount === false ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">不打折</span>
                          ) : null}
                          {product.allow_points === false ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">不积分</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle text-xs text-gray-600">
                      <div>{product.category || '其他'}</div>
                      <div className="text-gray-400">
                        {[product.brand, product.model, product.frame_type, product.lens_type]
                          .filter(Boolean)
                          .join(' / ') || '—'}
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 align-middle text-xs text-gray-700 xl:table-cell">
                      {(product.category || '').trim() === '套餐'
                        ? '套餐（镜框+镜片）'
                        : product.frame_type && product.lens_type
                          ? '套装（镜框+镜片）'
                          : product.lens_type
                            ? '镜片'
                            : product.frame_type
                              ? '镜框'
                              : product.category || '其他'}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {product.is_promo && product.promo_price != null ? (
                        <div>
                          <span className="text-xs text-gray-400 line-through">￥{product.price.toFixed(2)}</span>
                          <div className="font-semibold text-rose-700">￥{Number(product.promo_price).toFixed(2)}</div>
                        </div>
                      ) : (
                        <>￥{product.price.toFixed(2)}</>
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col gap-0.5 leading-tight">
                        <span
                          className={`text-base tabular-nums tracking-tight ${
                            isWarnRow ? 'font-bold text-red-600' : 'font-semibold text-gray-900'
                          }`}
                        >
                          {product.stock}
                        </span>
                        <span className="text-[11px] text-gray-500">
                          预警 <span className="tabular-nums text-gray-600">{th}</span>
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 align-middle text-gray-500 xl:table-cell">
                      {new Date(product.created_at).toLocaleDateString()}
                    </td>
                    <td
                      className={`max-xl:sticky max-xl:right-0 max-xl:z-[1] max-xl:shadow-[-10px_0_14px_-10px_rgba(15_23_42/0.14)] px-2 py-2 text-right align-middle xl:px-3 xl:shadow-none ${actionCellBg} xl:bg-transparent`}
                    >
                      <div className="inline-flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title="编辑"
                          onClick={() => openEditForm(product)}
                          className="touch-manipulation rounded-xl p-2.5 text-blue-600/90 transition-colors hover:bg-blue-50/90 active:bg-blue-100/80"
                        >
                          <Pencil className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                          <span className="sr-only">编辑</span>
                        </button>
                        <button
                          type="button"
                          title="删除"
                          onClick={() => handleDelete(product.id)}
                          className="touch-manipulation rounded-xl p-2.5 text-red-600/90 transition-colors hover:bg-red-50/90 active:bg-red-100/80"
                        >
                          <Trash2 className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                          <span className="sr-only">删除</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-gray-500">
                    未找到匹配商品
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DraggableCashierModal
        open={brandImportOpen}
        onClose={() => {
          if (brandImportBusy || brandImportWriteBusy) return;
          closeBrandImportModal();
        }}
        title="新增品牌 · AI 识别价目"
        maxWidthClassName="max-w-5xl"
      >
        <div className="space-y-4 px-4 pb-2 pt-1 md:px-5 md:pb-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            <span>
              上传 PDF / Excel(.xlsx) / PPT(.pptx) / 图片（可多选），自动提取并调用 AI 生成商品清单；镜片字段规则与「新增商品」中镜片一致（品牌·系列/折射率、镜框填品牌型号与镜框属性）。
            </span>
          </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm text-gray-600">
                  <span className="block mb-1">选择文件</span>
                  <input
                    type="file"
                    accept=".pdf,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*"
                    multiple
                    disabled={brandImportBusy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []).sort((a, b) =>
                        a.name.localeCompare(b.name, 'zh-CN'),
                      );
                      setBrandImportFiles(files);
                      setBrandImportErr(null);
                    }}
                    className="block w-full max-w-md text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-violet-50 file:text-violet-800"
                  />
                </label>
                <button
                  type="button"
                  disabled={brandImportBusy || brandImportFiles.length === 0}
                  onClick={() => void runBrandImportAi()}
                  className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
                >
                  {brandImportBusy ? '识别中…' : '开始 AI 识别'}
                </button>
              </div>
              {brandImportFiles.length > 0 ? (
                <div className="text-xs text-gray-500">
                  已选文件（按文件名排序）：{brandImportFiles.map((f) => f.name).join('，')}
                </div>
              ) : null}
              {brandImportMeta ? (
                <p className="text-xs text-gray-500">
                  文件：{brandImportMeta.fileName || '—'}；提取约 {brandImportMeta.textLength ?? '—'} 字
                  {brandImportMeta.truncated ? '（已截断参与识别，建议拆文件或导出精简表）' : ''}
                </p>
              ) : null}
              {brandImportErr ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {brandImportErr}
                </div>
              ) : null}
              {brandImportMatching ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  正在自动对齐标准库商品，请稍候...
                </div>
              ) : null}

              {brandImportRows.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800">
                      识别结果（{brandImportRows.length} 条，可编辑后勾选写入）
                    </p>
                    <button
                      type="button"
                      className="text-xs text-violet-700 hover:underline"
                      onClick={() =>
                        setBrandImportRows((prev) => prev.map((r) => ({ ...r, selected: true })))
                      }
                    >
                      全选
                    </button>
                  </div>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[min(48vh,420px)] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                        <tr>
                          <th className="px-2 py-2 w-8">选</th>
                          <th className="px-2 py-2">分类</th>
                          <th className="px-2 py-2 min-w-[140px]">名称</th>
                          <th className="px-2 py-2 min-w-[120px]">镜片属性</th>
                          <th className="px-2 py-2 min-w-[160px]">品牌·型号·镜框</th>
                          <th className="px-2 py-2 w-24">单价</th>
                          <th className="px-2 py-2 w-20">库存</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {brandImportRows.map((r) => (
                          <tr key={r.id} className="hover:bg-gray-50/80">
                            <td className="px-2 py-1.5 align-top">
                              <input
                                type="checkbox"
                                checked={r.selected}
                                onChange={() => toggleBrandImportRow(r.id)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <select
                                value={r.category}
                                onChange={(e) => patchBrandImportRow(r.id, { category: e.target.value })}
                                className="w-full border border-gray-200 rounded px-1 py-1 bg-white"
                              >
                                <option value="镜框">镜框</option>
                                <option value="镜片">镜片</option>
                                <option value="套餐">套餐</option>
                                <option value="隐形">隐形</option>
                                <option value="配件">配件</option>
                                <option value="其他">其他</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <div className="relative">
                                <input
                                  value={r.name}
                                  onChange={(e) => {
                                    patchBrandImportRow(r.id, { name: e.target.value });
                                    setBrandImportMatchMap((prev) => ({
                                      ...prev,
                                      [r.id]: { status: 'idle', message: '', matchedProduct: null, candidates: [] },
                                    }));
                                  }}
                                  className="w-full min-w-[120px] border border-gray-200 rounded px-1 py-1"
                                />
                                {brandImportMatchMap[r.id]?.status === 'fuzzy' &&
                                (brandImportMatchMap[r.id]?.candidates?.length || 0) > 0 ? (
                                  <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded border border-gray-200 bg-white shadow">
                                    {brandImportMatchMap[r.id].candidates.map((c) => (
                                      <button
                                        key={`${r.id}-${c.id}`}
                                        type="button"
                                        onClick={() => applyBrandImportCandidate(r.id, c)}
                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                      >
                                        <div className="text-xs text-gray-900">{c.name}</div>
                                        <div className="text-[11px] text-gray-500">￥{Number(c.price || 0).toFixed(2)} · 库存 {c.stock ?? 0}</div>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              {brandImportMatchMap[r.id]?.status === 'loading' ? (
                                <p className="mt-1 text-[11px] text-blue-700">正在匹配标准库商品...</p>
                              ) : null}
                              {brandImportMatchMap[r.id]?.status === 'exact' ? (
                                <p className="mt-1 text-[11px] text-emerald-700">
                                  已自动匹配标准库商品：{brandImportMatchMap[r.id]?.matchedProduct?.name || r.name}
                                </p>
                              ) : null}
                              {brandImportMatchMap[r.id]?.status === 'none' ? (
                                <p className="mt-1 text-[11px] text-amber-700">库中无此型号，是否作为新商品入库？</p>
                              ) : null}
                              {brandImportMatchMap[r.id]?.status === 'error' ? (
                                <p className="mt-1 text-[11px] text-red-700">
                                  自动匹配失败：{brandImportMatchMap[r.id]?.message || '未知错误'}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <textarea
                                value={r.lens_type || ''}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, { lens_type: e.target.value || null })
                                }
                                rows={2}
                                placeholder="如：蔡司 · 泽锐 / 1.67"
                                className="w-full min-w-[100px] border border-gray-200 rounded px-1 py-1"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-top space-y-1">
                              <input
                                value={r.brand || ''}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, {
                                    brand: e.target.value.trim() || null,
                                  })
                                }
                                placeholder="品牌"
                                className="w-full border border-gray-200 rounded px-1 py-0.5 block"
                              />
                              <input
                                value={r.model || ''}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, {
                                    model: e.target.value.trim() || null,
                                  })
                                }
                                placeholder="型号"
                                className="w-full border border-gray-200 rounded px-1 py-0.5 block"
                              />
                              <input
                                value={r.frame_type || ''}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, {
                                    frame_type: e.target.value.trim() || null,
                                  })
                                }
                                placeholder="镜框属性"
                                className="w-full border border-gray-200 rounded px-1 py-0.5 block"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={r.price}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, { price: Number(e.target.value) || 0 })
                                }
                                className="w-full border border-gray-200 rounded px-1 py-1"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={r.stock}
                                onChange={(e) =>
                                  patchBrandImportRow(r.id, {
                                    stock: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                  })
                                }
                                className="w-full border border-gray-200 rounded px-1 py-1"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">
                    当前服务端入库接口仅持久化「名称、单价、库存」；镜框识别到的型号/尺寸会自动拼进商品名称，收银台可直接显示说明，无需再手动选择。
                  </p>
                </div>
              ) : null}

          <div className="sticky bottom-0 z-[1] -mx-4 mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85 md:-mx-5 md:px-5">
            <button
              type="button"
              onClick={closeBrandImportModal}
              disabled={brandImportBusy || brandImportWriteBusy || brandImportTemplateBusy}
              className="rounded-lg border border-gray-200 px-4 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={brandImportTemplateBusy || brandImportRows.length === 0}
              onClick={() => void writeBrandImportToTemplate()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {brandImportTemplateBusy ? '写模板中…' : '将勾选商品写入模板'}
            </button>
            <button
              type="button"
              disabled={brandImportWriteBusy || brandImportRows.length === 0}
              onClick={() => void writeBrandImportToInventory()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {brandImportWriteBusy ? '写库存中…' : '将勾选商品写入库存'}
            </button>
          </div>
        </div>
      </DraggableCashierModal>

      <DraggableCashierModal
        open={showForm}
        onClose={resetForm}
        title={editingProduct ? '编辑商品' : isPackagesRoute ? '新增套餐' : '新增商品'}
        maxWidthClassName="max-w-3xl"
      >
        <div className="grid touch-pan-y grid-cols-1 gap-4 overscroll-contain p-4 md:grid-cols-2 md:p-5">
              <div className="md:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">入库拍照识别（选填）</p>
                  <p className="mt-1 text-[11px] text-gray-600 leading-snug">
                    「相册选图」从本机选文件；「拍照识别」打开<strong>实时摄像头</strong>（非系统选文件框）。服务端在{' '}
                    <code className="text-[10px]">public/inventory_ref</code> 存档后 OCR + AI 回填；未识别项请在
                    <strong>下方</strong>手填采购价、零售价与折射率。
                  </p>
                </div>
                <input
                  ref={inventoryEntryGalleryInputRef}
                  id={inventoryEntryGalleryId}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void processInventoryEntryOcrFile(f);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor={inventoryEntryGalleryId}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 ${
                      inventoryEntryOcrBusy ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    <ImageIcon className="w-4 h-4 shrink-0" />
                    相册选图
                  </label>
                  <button
                    type="button"
                    disabled={inventoryEntryOcrBusy}
                    onClick={() => setInventoryWebCamOpen(true)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 ${
                      inventoryEntryOcrBusy ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    拍照识别
                  </button>
                  {inventoryEntryEvidenceUrl ? (
                    <button
                      type="button"
                      disabled={inventoryEntryOcrBusy}
                      onClick={() => {
                        setInventoryEntryEvidenceUrl(null);
                        setInventoryEntryOcrHint(null);
                      }}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      清除存证预览
                    </button>
                  ) : null}
                </div>
                {inventoryEntryOcrBusy ? (
                  <p className="text-xs font-medium text-emerald-800">正在上传并存档、识别中…</p>
                ) : null}
                {inventoryEntryOcrHint ? (
                  <p className="text-[11px] text-amber-900 bg-amber-50/90 border border-amber-100 rounded-lg px-2 py-1.5">
                    {inventoryEntryOcrHint}
                  </p>
                ) : null}
                {inventoryEntryEvidenceUrl ? (
                  <div className="rounded-lg border border-emerald-100 bg-white p-2">
                    <p className="mb-1 text-[10px] text-gray-500">存证预览（同源路径）</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={inventoryEntryEvidenceUrl}
                      alt="入库存证"
                      className="mx-auto max-h-52 w-full max-w-lg object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-center text-[11px] text-gray-500 py-2 border border-dashed border-emerald-200/80 rounded-lg bg-white/60">
                    尚未拍摄；拍照后此处显示存证图
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-0.5">采购价（元）</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={formData.purchase_price}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, purchase_price: e.target.value }))
                      }
                      placeholder="AI 未识别时手填"
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-0.5">折射率 n（补录）</label>
                    <input
                      value={formData.refractive_index}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, refractive_index: e.target.value }))
                      }
                      placeholder="如 1.67"
                      inputMode="decimal"
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  零售价请在下方「零售价」字段填写；AI 若识别到建议零售价会尝试自动填入该框。
                </p>
              </div>

              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-sm text-gray-600">商品名称</label>
                  {(formData.category === '镜框' || formData.category === '套餐') && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-gray-500">镜框拍照识别</span>
                      <button
                        type="button"
                        disabled={inventoryEntryOcrBusy}
                        onClick={() => {
                          inventoryEntryGalleryInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                        相册
                      </button>
                      <button
                        type="button"
                        disabled={inventoryEntryOcrBusy}
                        onClick={() => setInventoryWebCamOpen(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <Camera className="h-3.5 w-3.5 shrink-0" />
                        拍照
                      </button>
                    </div>
                  )}
                </div>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">商品分类</label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormData((prev) => {
                      const wasLensForm = prev.category === '镜片' || prev.category === '套餐';
                      const nowLensForm = next === '镜片' || next === '套餐';
                      const patch: Partial<typeof prev> = { category: next };
                      if (!nowLensForm) {
                        patch.lens_type = '';
                        if (
                          wasLensForm &&
                          prev.brand === '自定义' &&
                          (prev.model === '进口' || prev.model === '国产')
                        ) {
                          patch.brand = '';
                          patch.model = '';
                        }
                      }
                      return { ...prev, ...patch };
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="镜框">镜框</option>
                  <option value="镜片">镜片</option>
                  <option value="套餐">套餐（镜框+镜片）</option>
                  <option value="隐形">隐形</option>
                  <option value="配件">配件</option>
                  <option value="其他">其他</option>
                </select>
                {formData.category === '套餐' ? (
                  <p className="mt-1.5 text-[11px] text-violet-700/90 leading-snug">
                    套餐为成套售价：请填写下方「镜框属性」与「镜片属性」（可用镜片品牌下拉自动生成镜片规格）。
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">品牌</label>
                {isLensCategoryForm ? (
                  <select
                    value={lensBrandSelectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') {
                        setFormData((prev) => ({ ...prev, brand: '自定义', model: '' }));
                        return;
                      }
                      if (v === '进口' || v === '国产') {
                        setFormData((prev) => ({ ...prev, brand: '自定义', model: v }));
                        return;
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">自定义</option>
                    <option value="进口">自定义 + 进口（大陆）</option>
                    <option value="国产">自定义 + 国产（大陆）</option>
                  </select>
                ) : (
                  <input
                    value={formData.brand}
                    onChange={(e) => setFormData((prev) => ({ ...prev, brand: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">型号</label>
                <input
                  value={formData.model}
                  onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
                  disabled={isLensCategoryForm && formData.brand === '自定义' && !!lensCustomOrigin}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                {isLensCategoryForm && formData.brand === '自定义' && !!lensCustomOrigin && (
                  <p className="mt-1 text-[11px] text-gray-500">已按“自定义+{lensCustomOrigin}”锁定型号，无需手工输入。</p>
                )}
              </div>
              {isLensCategoryForm && lensCustomOrigin === '进口' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">进口品牌</label>
                    <select
                      value={importLensBrand}
                      onChange={(e) => {
                        const b = e.target.value as typeof IMPORT_LENS_BRANDS[number];
                        if (!b) return;
                        const firstSeries = IMPORT_LENS_CATALOG[b]?.[0];
                        const firstIndex = firstSeries?.indices?.[0] ?? 1.60;
                        const firstSeriesName = firstSeries?.series ?? '';
                        if (!firstSeriesName) return;
                        setLensPreset('进口', b, firstSeriesName, firstIndex);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择进口品牌</option>
                      {IMPORT_LENS_BRANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">镜片系列（下拉自动填充）</label>
                    <select
                      value={matchedSeries || ''}
                      onChange={(e) => {
                        const nextSeries = e.target.value;
                        if (!nextSeries) return;
                        const option = availableSeries.find((x) => x.series === nextSeries);
                        const nextIndex = option?.indices?.[0] ?? 1.60;
                        if (!importLensBrand) return;
                        setLensPreset('进口', importLensBrand as LensBrandKey, nextSeries, nextIndex);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择系列</option>
                      {availableSeries.map((opt) => (
                        <option key={opt.series} value={opt.series}>
                          {opt.series}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">折射率（n）</label>
                    <select
                      value={matchedIndexStr || ''}
                      onChange={(e) => {
                        const idx = Number.parseFloat(e.target.value);
                        if (!Number.isFinite(idx)) return;
                        const series = matchedSeries || availableSeries[0]?.series || '';
                        if (!series) return;
                        if (!importLensBrand) return;
                        setLensPreset('进口', importLensBrand as LensBrandKey, series, idx);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择折射率</option>
                      {availableSeries
                        .find((x) => x.series === (matchedSeries || availableSeries[0]?.series))
                        ?.indices.map((n) => (
                          <option key={n} value={formatIndex(n)}>
                            {formatIndex(n)}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}
              {isLensCategoryForm && lensCustomOrigin === '国产' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">国产品牌</label>
                    <select
                      value={domesticLensBrand}
                      onChange={(e) => {
                        const b = e.target.value as typeof DOMESTIC_LENS_BRANDS[number];
                        if (!b) return;
                        const firstSeries = DOMESTIC_LENS_CATALOG[b]?.[0];
                        const firstIndex = firstSeries?.indices?.[0] ?? 1.60;
                        const firstSeriesName = firstSeries?.series ?? '';
                        if (!firstSeriesName) return;
                        setLensPreset('国产', b, firstSeriesName, firstIndex);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择国产品牌</option>
                      {DOMESTIC_LENS_BRANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">镜片系列（下拉自动填充）</label>
                    <select
                      value={matchedSeries || ''}
                      onChange={(e) => {
                        const nextSeries = e.target.value;
                        if (!nextSeries) return;
                        const option = availableSeries.find((x) => x.series === nextSeries);
                        const nextIndex = option?.indices?.[0] ?? 1.60;
                        if (!domesticLensBrand) return;
                        setLensPreset('国产', domesticLensBrand as LensBrandKey, nextSeries, nextIndex);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择系列</option>
                      {availableSeries.map((opt) => (
                        <option key={opt.series} value={opt.series}>
                          {opt.series}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">折射率（n）</label>
                    <select
                      value={matchedIndexStr || ''}
                      onChange={(e) => {
                        const idx = Number.parseFloat(e.target.value);
                        if (!Number.isFinite(idx)) return;
                        const series = matchedSeries || availableSeries[0]?.series || '';
                        if (!series) return;
                        if (!domesticLensBrand) return;
                        setLensPreset('国产', domesticLensBrand as LensBrandKey, series, idx);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">请选择折射率</option>
                      {availableSeries
                        .find((x) => x.series === (matchedSeries || availableSeries[0]?.series))
                        ?.indices.map((n) => (
                          <option key={n} value={formatIndex(n)}>
                            {formatIndex(n)}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}
              {isLensCategoryForm ? (
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">镜片属性</label>
                  <input
                    value={formData.lens_type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, lens_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    placeholder="如：防蓝光/1.67（若选择了系列，将自动生成）"
                  />
                </div>
              ) : null}
              <div>
                <label className="block text-sm text-gray-600 mb-1">镜框属性</label>
                <input
                  value={formData.frame_type}
                  onChange={(e) => setFormData((prev) => ({ ...prev, frame_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                  placeholder="如：全框/钛架"
                />
              </div>

              <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
                      镜架主图（选填）
                    </p>
                    <p className="mt-1 text-[11px] text-gray-600 leading-snug">
                      上传后由服务端写入 OSS，路径规范为{' '}
                      <code className="text-[10px] bg-white/80 px-1 rounded">records/admin-frames/&lt;时间戳&gt;_frame.jpg</code>
                      ，与混元 3D 测试脚本 <code className="text-[10px] bg-white/80 px-1 rounded">test-tencent-3d</code>{' '}
                      自动拉取最新镜架图一致（文件名中 <code className="text-[10px] bg-white/80 px-1">_frame</code> 固定）。
                    </p>
                  </div>
                </div>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void uploadFrameImageFile(f);
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void uploadFrameImageFile(f);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={frameImageBusy}
                    onClick={() => galleryInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-white text-sm text-gray-800 hover:bg-blue-50 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    本地文件
                  </button>
                  <button
                    type="button"
                    disabled={frameImageBusy}
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-white text-sm text-gray-800 hover:bg-blue-50 disabled:opacity-50"
                  >
                    <Camera className="w-4 h-4" />
                    拍照
                  </button>
                  {(framePreviewUrl || frameUploadMeta) && (
                    <button
                      type="button"
                      disabled={frameImageBusy}
                      onClick={clearFrameImageUpload}
                      className="inline-flex items-center px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      清除图片
                    </button>
                  )}
                </div>
                {frameImageBusy ? (
                  <p className="text-xs text-blue-700">正在上传至 OSS…</p>
                ) : null}
                {frameImageError ? <p className="text-xs text-red-600">{frameImageError}</p> : null}
                {frameUploadMeta ? (
                  <p className="text-[11px] text-emerald-800 bg-emerald-50/90 border border-emerald-100 rounded-lg px-2 py-1.5 break-all">
                    已上传：<span className="font-mono">{frameUploadMeta.objectKey}</span>
                  </p>
                ) : null}
                {framePreviewUrl ? (
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={framePreviewUrl}
                      alt="镜架预览"
                      className="max-h-40 rounded-lg border border-gray-200 object-contain bg-white"
                    />
                  </div>
                ) : null}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">零售价（元）</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => setFormData((prev) => ({ ...prev, price: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">库存</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.stock}
                  onChange={(e) => setFormData((prev) => ({ ...prev, stock: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">低库存预警线</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.low_stock_threshold}
                  onChange={(e) => setFormData((prev) => ({ ...prev, low_stock_threshold: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-[11px] text-gray-500">库存大于 0 且低于该值时标为低库存（默认 10）。</p>
              </div>

              <div className="md:col-span-2 rounded-xl border border-gray-100 bg-gray-50/80 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">经营属性（收银联动）</p>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_hot}
                      onChange={(e) => setFormData((prev) => ({ ...prev, is_hot: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    热卖
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_promo}
                      onChange={(e) => setFormData((prev) => ({ ...prev, is_promo: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    特价
                  </label>
                </div>
                {formData.is_promo ? (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">特价金额（￥）</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.promo_price}
                      onChange={(e) => setFormData((prev) => ({ ...prev, promo_price: e.target.value }))}
                      className="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      placeholder="收银加入购物车时默认此单价"
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_discount}
                      onChange={(e) => setFormData((prev) => ({ ...prev, allow_discount: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    店长可打折扣
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_points}
                      onChange={(e) => setFormData((prev) => ({ ...prev, allow_points: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    参与会员积分（预留）
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_promo_price}
                      onChange={(e) => setFormData((prev) => ({ ...prev, allow_promo_price: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    收银使用特价价
                  </label>
                </div>
              </div>

            <div className="sticky bottom-0 z-[1] -mx-4 mt-2 flex justify-end gap-3 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85 md:col-span-2 md:-mx-5 md:px-5">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-gray-200 px-4 py-2 text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? '保存中...' : '保存'}
              </button>
            </div>
            </div>
      </DraggableCashierModal>

      <WebCameraCaptureModal
        open={inventoryWebCamOpen}
        onClose={() => setInventoryWebCamOpen(false)}
        title="入库 · 摄像头拍照"
        onCapture={async (blob) => {
          const file = new File([blob], 'stock_entry.jpg', { type: 'image/jpeg' });
          await processInventoryEntryOcrFile(file);
        }}
      />
    </div>
  );
}
