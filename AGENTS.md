<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Catalog / 数字化手册

若 `public/catalog/<品牌>/` 仅有 PDF、缺少 `p*.jpg`：按资源自愈执行 `npm run catalog:pdf-to-jpg-pages` 并同步页表（见 `.cursor/rules/catalog-asset-self-heal.mdc`）。

侧栏与物理凸标：**StandardEye V1.3** 见 **`.cursor/rules/standardeye-handbook.mdc`**（详规；根目录 `.cursorrules` 仅索引）。豪雅扫描超参见 `src/lib/catalog/hoyaPhysicalTabScanParams.ts`。
