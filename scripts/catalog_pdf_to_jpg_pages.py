#!/usr/bin/env python3
"""
Catalog PDF → p{n}.jpg（Matrix V1.3 · 资源自愈）

**仓库首选**：无 Python 时用 Node — `npm run catalog:pdf-to-jpg-pages -- --dir public/catalog/hoya`
（见 `catalog-pdf-to-jpg-pages.mjs`，写入 `hoyaHandbookPageCount.json`）。

用法:
  python scripts/catalog_pdf_to_jpg_pages.py --dir public/catalog/hoya [--dpi 175]

规则:
  - 在指定目录下查找首个 *.pdf（忽略大小写）
  - 输出子目录 pages/p1.jpg … pages/pN.jpg（覆盖已存在同名文件）
  - 默认 DPI 175（72 * zoom）；可用 --dpi 150–200
  - 结束时打印一行 JSON: {"pages":N,"dir":"...","pdf":"..."}
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def find_pdf(catalog_dir: Path) -> Path:
    pdfs = sorted(catalog_dir.glob("*.pdf")) + sorted(catalog_dir.glob("*.PDF"))
    if not pdfs:
        raise FileNotFoundError(f"No PDF under {catalog_dir}")
    return pdfs[0]


def main() -> int:
    ap = argparse.ArgumentParser(description="Rasterize catalog PDF to p{n}.jpg")
    ap.add_argument(
        "--dir",
        type=Path,
        required=True,
        help="Brand folder under repo root, e.g. public/catalog/hoya",
    )
    ap.add_argument("--dpi", type=float, default=175.0, help="Raster DPI (default 175)")
    args = ap.parse_args()
    root = Path(__file__).resolve().parents[1]
    out_dir = (root / args.dir).resolve() if not args.dir.is_absolute() else args.dir
    if not out_dir.is_dir():
        print(f"ERROR: not a directory: {out_dir}", file=sys.stderr)
        return 2
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = find_pdf(out_dir)
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("ERROR: pip install pymupdf", file=sys.stderr)
        return 3

    dpi = max(72.0, min(300.0, float(args.dpi)))
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    doc = fitz.open(pdf_path)
    n = doc.page_count
    for i in range(n):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out_path = pages_dir / f"p{i + 1}.jpg"
        # PyMuPDF：优先 output=jpeg；旧版回退 tobytes
        try:
            pix.save(out_path.as_posix(), output="jpeg", jpg_quality=88)
        except (TypeError, AttributeError, ValueError):
            out_path.write_bytes(pix.tobytes("jpeg", jpg_quality=88))
    doc.close()

    rel_brand = str(out_dir.relative_to(root)).replace("\\", "/")
    rel_pages = str(pages_dir.relative_to(root)).replace("\\", "/")
    if "hoya" in rel_brand.lower():
        meta_path = root / "src" / "data" / "hoyaHandbookPageCount.json"
        meta_path.write_text(
            json.dumps(
                {
                    "pages": n,
                    "total": n,
                    "dir": rel_brand,
                    "pagesDir": rel_pages,
                    "pdf": pdf_path.name,
                    "generatedAt": datetime.now(timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z"),
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {meta_path.relative_to(root)}", file=sys.stderr)

    print(
        json.dumps(
            {"pages": n, "dir": rel_brand, "pagesDir": rel_pages, "pdf": pdf_path.name},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
