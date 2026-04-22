# 蔡司数字化手册资产

## 当前约定（以物理文件为准）

1. **页图**：仅将 **`.jpg` / `.jpeg`** 放入 `public/catalog/zeiss-handbook/`（可分子文件夹）。`GET /api/catalog/zeiss-manifest` **只扫描该目录**，按文件名排序生成 `pages`，每页 `imageUrl` 与文件 **1:1**，不再使用本目录 `manifest.json` 里的 `pages` 文字占位。

2. **系列与右侧标签**：由**文件名或父文件夹名**关键词推断；含 **「成长乐」**（或 `growthjoy`）的页归入 **成长乐** 系列，标签 **「成长乐」** 的 `startPage` 为该系列在排序列表中的**首次出现页**（0-based），点击标签会 `flip()` 到该页。

3. **其它关键词**（不区分大小写）：`smartlife`/`智锐`、`drivesafe`/`驾驶`、`bosharp`/`博锐`/`单光`、`office`/`办公`、`pricing`/`价格`/`总表`。

4. **`manifest.json`（本目录）**：仅建议保留 **`title`**、可选 **`pageAspect`**（默认单页宽高比 3:4 竖版）。**请勿再维护 `pages` / `sections`**，以免与扫描结果不一致。

5. **规范重命名（可选）**：在项目根执行  
   `node scripts/normalize-zeiss-handbook.mjs` 预览；  
   `node scripts/normalize-zeiss-handbook.mjs --apply` 将文件重命名为 `{系列id}_{序号}.jpg`（基于当前文件名/路径关键词分类，**非 OCR**；若需按画面文字归档请人工校对后再 `--apply`）。
