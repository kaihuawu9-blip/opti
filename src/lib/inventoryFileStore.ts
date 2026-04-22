import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 实验用：不连 PostgreSQL 时，把库存/套餐商品存到项目目录下的 JSON 文件。
 * 在 .env.local 中设置 USE_LOCAL_INVENTORY_FILE=1 生效。
 */
export function isLocalInventoryFileEnabled(): boolean {
  const v = process.env.USE_LOCAL_INVENTORY_FILE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * 解析可写根目录：优先 `LOCAL_INVENTORY_FILE_PATH` 的目录；
 * Electron 已打包时优先 `app.getPath('userData')`；其余为 `process.cwd()`。
 */
function inventoryBaseDir(): string {
  try {
    if (process.versions.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      const app = electron.app ?? electron.default?.app;
      if (app && typeof app.getPath === 'function' && app.isPackaged) {
        return app.getPath('userData');
      }
    }
  } catch {
    // 非 Electron 主进程 / 无 electron 包
  }

  return process.cwd();
}

export function resolveInventoryFilePath(): string {
  const custom = process.env.LOCAL_INVENTORY_FILE_PATH?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  }
  return path.join(inventoryBaseDir(), 'data', 'dev-inventory.json');
}

/** 与 mapRow 输入兼容的持久化行 */
export type FileInventoryRecord = {
  id: string;
  store_id: string | null;
  name: string | null;
  stock: number | null;
  price: unknown;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  frame_type?: string | null;
  lens_type?: string | null;
  refractive_index?: number | null;
  coating?: string | null;
  low_stock_threshold?: number | null;
  is_hot?: boolean | null;
  is_promo?: boolean | null;
  promo_price?: unknown;
  allow_discount?: boolean | null;
  allow_points?: boolean | null;
  allow_promo_price?: boolean | null;
};

type FileRoot = { version: number; items: FileInventoryRecord[] };

function isRecord(r: unknown): r is Record<string, unknown> {
  return r !== null && typeof r === 'object' && !Array.isArray(r);
}

/** 与 load 的宽松 parse 不同：用于落盘前校验，失败则不可覆盖主文件 */
function assertValidFileRootJson(raw: string): FileRoot {
  const data = JSON.parse(raw) as unknown;
  if (!isRecord(data)) throw new Error('root_not_object');
  if (!('items' in data) || !Array.isArray(data.items)) throw new Error('items_not_array');
  for (const it of data.items) {
    if (!isRecord(it) || typeof it.id !== 'string' || !it.id.trim()) {
      throw new Error('invalid_item');
    }
  }
  return { version: 1, items: data.items as FileInventoryRecord[] };
}

function quarantineCorruptFile(p: string): void {
  if (!existsSync(p)) return;
  const bad = `${p}.bad.${Date.now()}`;
  try {
    renameSync(p, bad);
  } catch (e) {
    console.error('[inventoryFileStore] could not quarantine bad file', p, e);
  }
}

export async function loadInventoryFile(): Promise<FileInventoryRecord[]> {
  const p = resolveInventoryFilePath();
  if (!existsSync(p)) {
    return [];
  }
  const raw = await readFile(p, 'utf8');
  try {
    return assertValidFileRootJson(raw).items;
  } catch (e) {
    console.error('[inventoryFileStore] invalid JSON, quarantining', p, e);
    quarantineCorruptFile(p);
    return [];
  }
}

/**
 * 原子替换：先写 .tmp，校验 JSON 结构后再 rename 到目标文件。
 */
export async function saveInventoryFile(items: FileInventoryRecord[]): Promise<void> {
  const p = resolveInventoryFilePath();
  const dir = path.dirname(p);
  await mkdir(dir, { recursive: true });
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const body: FileRoot = { version: 1, items };
  const json = JSON.stringify(body, null, 2);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, json, 'utf8');
  try {
    const check = readFileSync(tmp, 'utf8');
    assertValidFileRootJson(check);
    renameSync(tmp, p);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw e;
  }
}

export function newInventoryId(): string {
  return randomUUID();
}

function num(v: unknown, fallback: number | null = null): number | null {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 从请求体提取与 Prisma `attributes` JSON 及本地行对齐的扩展字段（不含 id/name/stock/price/store_id 基列）。
 * 两分支 POST/PUT 应共用此结果再各自持久化，避免双头实现漂移。
 */
export function parseProductExtensionFromBody(
  body: Record<string, unknown>,
  base?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = base && isRecord(base) ? { ...base } : {};

  if ('category' in body) {
    out.category = body.category != null && String(body.category).trim() ? String(body.category) : '其他';
  }
  if ('brand' in body) {
    out.brand = body.brand != null && String(body.brand).trim() ? String(body.brand) : null;
  }
  if ('model' in body) {
    out.model = body.model != null && String(body.model).trim() ? String(body.model) : null;
  }
  if ('frame_type' in body) {
    out.frame_type = body.frame_type != null && String(body.frame_type).trim() ? String(body.frame_type) : null;
  }
  if ('lens_type' in body) {
    out.lens_type = body.lens_type != null && String(body.lens_type).trim() ? String(body.lens_type) : null;
  }
  if ('refractive_index' in body) {
    const n = num(body.refractive_index, null);
    out.refractive_index = n != null ? n : null;
  }
  if ('coating' in body) {
    out.coating = body.coating != null && String(body.coating).trim() ? String(body.coating) : null;
  }
  if ('low_stock_threshold' in body) {
    const t = num(body.low_stock_threshold, 10);
    if (t != null && t >= 0) out.low_stock_threshold = Math.trunc(t);
  }
  if ('is_hot' in body) out.is_hot = body.is_hot === true;
  if ('is_promo' in body) out.is_promo = body.is_promo === true;
  if ('promo_price' in body) {
    if (body.promo_price == null || body.promo_price === '') out.promo_price = null;
    else {
      const n = num(body.promo_price, null);
      out.promo_price = n;
    }
  }
  if ('allow_discount' in body) out.allow_discount = body.allow_discount !== false;
  if ('allow_points' in body) out.allow_points = body.allow_points !== false;
  if ('allow_promo_price' in body) out.allow_promo_price = body.allow_promo_price !== false;

  return out;
}

/** POST 新建时与 Prisma `attributes` 初始值一致 */
export const PRODUCT_EXTENSION_DEFAULTS: Record<string, unknown> = {
  category: '其他',
  low_stock_threshold: 10,
  allow_discount: true,
  allow_points: true,
  allow_promo_price: true,
  is_hot: false,
  is_promo: false,
  promo_price: null,
  brand: null,
  model: null,
  frame_type: null,
  lens_type: null,
  refractive_index: null,
  coating: null,
};

/** 从 POST/PUT 的 body 建立或合并一行（实验用，字段与 Prisma `attributes` + 基列 对齐） */
export function fileRecordFromCreateBody(body: Record<string, unknown>, id: string): FileInventoryRecord {
  const ext = parseProductExtensionFromBody(body, { ...PRODUCT_EXTENSION_DEFAULTS });
  const st = num(body.stock, 0);
  const pr = num(body.price, 0);
  return {
    id,
    store_id: typeof body.store_id === 'string' && body.store_id.trim() ? body.store_id.trim() : null,
    name: body.name != null ? String(body.name).trim() || null : null,
    stock: st != null ? Math.trunc(st) : 0,
    price: pr != null ? pr : 0,
    category: (ext.category as string) || '其他',
    brand: (ext.brand as string | null) ?? null,
    model: (ext.model as string | null) ?? null,
    frame_type: (ext.frame_type as string | null) ?? null,
    lens_type: (ext.lens_type as string | null) ?? null,
    refractive_index:
      ext.refractive_index != null && ext.refractive_index !== '' ? (num(ext.refractive_index, null) ?? null) : null,
    coating: (ext.coating as string | null) ?? null,
    low_stock_threshold: (() => {
      const t = num(ext.low_stock_threshold, 10);
      return t != null && t >= 0 ? Math.trunc(t) : 10;
    })(),
    is_hot: ext.is_hot === true,
    is_promo: ext.is_promo === true,
    promo_price: ext.promo_price,
    allow_discount: ext.allow_discount !== false,
    allow_points: ext.allow_points !== false,
    allow_promo_price: ext.allow_promo_price !== false,
  };
}

export function mergeFileRecordFromBody(base: FileInventoryRecord, body: Record<string, unknown>): FileInventoryRecord {
  const next: FileInventoryRecord = { ...base };
  if ('name' in body) next.name = body.name != null ? String(body.name).trim() || null : null;
  if ('stock' in body) {
    const s = num(body.stock, 0);
    if (s != null) next.stock = Math.trunc(s);
  }
  if ('price' in body) {
    const p = num(body.price, null);
    next.price = p != null ? p : null;
  }
  if ('store_id' in body) {
    next.store_id = typeof body.store_id === 'string' && body.store_id.trim() ? body.store_id.trim() : null;
  }
  const ext = parseProductExtensionFromBody(
    body,
    Object.fromEntries(
      Object.entries({
        category: next.category,
        brand: next.brand,
        model: next.model,
        frame_type: next.frame_type,
        lens_type: next.lens_type,
        refractive_index: next.refractive_index,
        coating: next.coating,
        low_stock_threshold: next.low_stock_threshold,
        is_hot: next.is_hot,
        is_promo: next.is_promo,
        promo_price: next.promo_price,
        allow_discount: next.allow_discount,
        allow_points: next.allow_points,
        allow_promo_price: next.allow_promo_price,
      }).filter(([, v]) => v !== undefined),
    ),
  );
  return {
    id: next.id,
    store_id: next.store_id,
    name: next.name,
    stock: next.stock,
    price: next.price,
    category: (ext.category as string) || '其他',
    brand: (ext.brand as string | null) ?? null,
    model: (ext.model as string | null) ?? null,
    frame_type: (ext.frame_type as string | null) ?? null,
    lens_type: (ext.lens_type as string | null) ?? null,
    refractive_index:
      ext.refractive_index != null && ext.refractive_index !== '' ? (num(ext.refractive_index, null) ?? null) : null,
    coating: (ext.coating as string | null) ?? null,
    low_stock_threshold: (() => {
      const t = num(ext.low_stock_threshold, 10);
      return t != null && t >= 0 ? Math.trunc(t) : 10;
    })(),
    is_hot: ext.is_hot === true,
    is_promo: ext.is_promo === true,
    promo_price: ext.promo_price,
    allow_discount: ext.allow_discount !== false,
    allow_points: ext.allow_points !== false,
    allow_promo_price: ext.allow_promo_price !== false,
  };
}
