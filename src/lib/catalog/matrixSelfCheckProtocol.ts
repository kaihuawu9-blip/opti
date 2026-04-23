/**
 * Matrix Self-Check Protocol
 *
 * - 启动时（Node / instrumentation）扫描 `MATRIX_BRAND_REGISTRY` 登记的 src/data 品牌链路；
 * - 校验手册 price 锚点与价目矩阵、物理页唯一性、`catalog_page_reference` 可解析性；
 * - 设置 `MATRIX_SELF_CHECK_STRICT=1` 可在 CI 中使自检失败直接 throw。
 */

import { MATRIX_BRAND_REGISTRY } from '@/data/matrixBrandRegistry';
import { ESSILOR_HANDBOOK_PAGE_MAP } from '@/data/essilorHandbookPageMap';
import {
  ZEISS_HANDBOOK_PAGE_IMAGE_DATA,
  ZEISS_PRICE_MATRIX,
  type CatalogPageReference,
  type ZeissProductMatrix,
} from '@/data/zeissPriceMatrix';
import {
  ZEISS_HANDBOOK_PAGE_MAP,
  assertMapConsistency,
  findFirstPdfPageForProduct,
  getPageData,
} from '@/data/zeissHandbookPageMap';
import {
  formatSchemaGapTodoMarkdown,
  runSchemaCompletenessScan,
  type SchemaGapItem,
} from '@/lib/catalog/indexAutoCalibrator';

export type { SchemaGapItem } from '@/lib/catalog/indexAutoCalibrator';

export type MatrixSelfCheckResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  scannedBrands: readonly string[];
  /** 矩阵 ↔ 手册导航 / 标题 的待补全项（不单独使 ok=false） */
  schemaCompletenessGaps: readonly SchemaGapItem[];
};

const BANNER = '[Matrix Self-Check Protocol]';

/** 解析每条矩阵产品的物理页锚；无显式字段时用手册 price 节反推 */
export function getEffectiveCatalogPageReference(
  product: ZeissProductMatrix,
): { ref: CatalogPageReference; inferred: boolean } | null {
  const ex = product.catalog_page_reference;
  if (ex && Number.isFinite(Number(ex.pdfIndex)) && Number(ex.pdfIndex) >= 1) {
    return {
      ref: {
        pdfIndex: Math.floor(Number(ex.pdfIndex)),
        printedPage: ex.printedPage ?? null,
      },
      inferred: false,
    };
  }
  const pdf = findFirstPdfPageForProduct(product.productName);
  if (pdf == null) return null;
  const entry = ZEISS_HANDBOOK_PAGE_MAP.find((e) => e.pdfPage === pdf);
  return {
    ref: {
      pdfIndex: pdf,
      printedPage: entry?.printedPage ?? null,
    },
    inferred: true,
  };
}

export function runMatrixSelfCheckProtocol(): MatrixSelfCheckResult {
  const errors: string[] = [...assertMapConsistency()];
  const warnings: string[] = [];
  const scannedBrands = MATRIX_BRAND_REGISTRY.map((b) => b.brandKey);

  for (const b of MATRIX_BRAND_REGISTRY) {
    console.info(
      `${BANNER} scan brand=${b.brandKey} (${b.label}) · ${b.handbookPageMapFile} + ${b.priceMatrixJsonFile}`,
    );
  }

  if (MATRIX_BRAND_REGISTRY.some((b) => b.brandKey === 'ESSILOR') && ESSILOR_HANDBOOK_PAGE_MAP.length === 0) {
    warnings.push(
      `${BANNER}[Multi-brand/V1.1] ESSILOR 已登记 MATRIX_BRAND_REGISTRY，但 essilorHandbookPageMap 为空 — 手册与插件 B 为「数据待补全」占位态`,
    );
  }

  const seenPdf = new Set<number>();
  for (const e of ZEISS_HANDBOOK_PAGE_MAP) {
    if (seenPdf.has(e.pdfPage)) {
      errors.push(`${BANNER} 手册映射存在重复 pdfPage=${e.pdfPage}，物理索引不唯一`);
    }
    seenPdf.add(e.pdfPage);
  }

  const priceAnchors = new Set(
    ZEISS_HANDBOOK_PAGE_MAP.filter((e) => e.section === 'price' && e.productName?.trim()).map((e) =>
      e.productName!.trim(),
    ),
  );
  const matrixNames = new Set(ZEISS_PRICE_MATRIX.map((p) => p.productName.trim()));

  for (const name of matrixNames) {
    if (!priceAnchors.has(name)) {
      errors.push(
        `${BANNER} 价目矩阵产品「${name}」在手册 section=price 中无对应 dataAnchor（无法绑定 pdfIndex）`,
      );
    }
  }

  if (priceAnchors.size !== matrixNames.size) {
    warnings.push(
      `${BANNER} 快照：手册 price 去重锚点=${priceAnchors.size}，矩阵品种=${matrixNames.size}（数量不一致时请补 pending / JSON）`,
    );
  }

  const imgKeys = Object.keys(ZEISS_HANDBOOK_PAGE_IMAGE_DATA).length;
  const maxPdf = ZEISS_HANDBOOK_PAGE_MAP.reduce((m, e) => Math.max(m, e.pdfPage), 0);
  if (imgKeys > 0 && imgKeys < maxPdf) {
    warnings.push(
      `${BANNER} handbookPageImageData 键数=${imgKeys} 小于最大物理页 ${maxPdf}，部分页可能无内嵌图`,
    );
  }

  for (const p of ZEISS_PRICE_MATRIX) {
    const eff = getEffectiveCatalogPageReference(p);
    if (!eff) {
      errors.push(
        `${BANNER} 产品「${p.productName}」缺少 catalog_page_reference 且无法从手册反推 pdfIndex`,
      );
      continue;
    }
    if (eff.inferred) {
      warnings.push(
        `${BANNER} 产品「${p.productName}」未在 JSON 声明 catalog_page_reference，已反推 pdfIndex=${eff.ref.pdfIndex}（建议在价目 JSON 固化）`,
      );
    }
    const page = getPageData(eff.ref.pdfIndex, 'zeiss');
    if (!page) {
      errors.push(
        `${BANNER} 产品「${p.productName}」catalog_page_reference.pdfIndex=${eff.ref.pdfIndex} 无法 getPageData`,
      );
      continue;
    }
    if (page.dataAnchor && page.dataAnchor !== p.productName.trim()) {
      errors.push(
        `${BANNER} 产品「${p.productName}」绑定 pdfIndex=${eff.ref.pdfIndex} 但 dataAnchor 为「${page.dataAnchor}」`,
      );
    }
  }

  const schemaCompletenessGaps = runSchemaCompletenessScan();
  for (const g of schemaCompletenessGaps) {
    warnings.push(`${BANNER}[Schema-Completeness] ${g.summary}`);
  }

  return { ok: errors.length === 0, errors, warnings, scannedBrands, schemaCompletenessGaps };
}

export function logMatrixSelfCheckOnBoot(): void {
  try {
    const r = runMatrixSelfCheckProtocol();
    for (const w of r.warnings) {
      console.warn(w);
    }
    for (const e of r.errors) {
      console.error(e);
    }
    if (!r.ok) {
      console.error(`${BANNER} 自检未通过：${r.errors.length} 条错误（见上）。设置 MATRIX_SELF_CHECK_STRICT=1 可在构建/启动时中断。`);
    } else if (r.warnings.length) {
      console.warn(`${BANNER} 自检通过，含 ${r.warnings.length} 条告警。`);
    } else {
      console.info(`${BANNER} 自检通过。`);
    }
    if (r.schemaCompletenessGaps.length > 0) {
      console.info(`${BANNER} Schema 待补全（${r.schemaCompletenessGaps.length} 项）↓\n${formatSchemaGapTodoMarkdown(r.schemaCompletenessGaps)}`);
    }
    if (process.env.MATRIX_SELF_CHECK_STRICT === '1' && !r.ok) {
      throw new Error(`${BANNER} strict 模式：${r.errors.join(' | ')}`);
    }
  } catch (e) {
    console.error(`${BANNER} 自检执行异常`, e);
    if (process.env.MATRIX_SELF_CHECK_STRICT === '1') {
      throw e;
    }
  }
}
