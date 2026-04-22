#!/usr/bin/env node
/**
 * 将 public/catalog/zeiss-handbook 下 JPEG 规范重命名为 {seriesId}_{nnn}.jpg
 * 系列由路径/文件名关键词推断（与 scanPublicZeissHandbook 一致逻辑，非 OCR）。
 * 用法：node scripts/normalize-zeiss-handbook.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HAND = path.join(ROOT, 'public', 'catalog', 'zeiss-handbook');
const JPEG = /\.jpe?g$/i;

function classifyToken(raw) {
  const t = String(raw).toLowerCase();
  if (t.includes('成长乐') || t.includes('growthjoy') || t.includes('myovision') || t.includes('myokine')) return 'growthjoy';
  if (t.includes('smart') || t.includes('智锐') || t.includes('smartlife')) return 'smartlife';
  if (t.includes('drive') || t.includes('驾驶') || t.includes('drivesafe')) return 'drivesafe';
  if (t.includes('bosharp') || t.includes('博锐') || t.includes('单光')) return 'bosharp';
  if (t.includes('office') || t.includes('办公') || t.includes('数码')) return 'office';
  if (t.includes('pric') || t.includes('总表') || t.includes('价格')) return 'pricing';
  return 'misc';
}

function sectionIdForRel(rel) {
  const norm = rel.replace(/\\/g, '/');
  const parts = norm.split('/');
  if (parts.length > 1) {
    const folder = classifyToken(parts[0]);
    if (folder !== 'misc') return folder;
  }
  return classifyToken(path.basename(norm));
}

function collectRels() {
  if (!fs.existsSync(HAND)) return [];
  const out = [];
  for (const ent of fs.readdirSync(HAND, { withFileTypes: true })) {
    const p = path.join(HAND, ent.name);
    if (ent.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (!JPEG.test(f)) continue;
        out.push(`${ent.name}/${f}`.replace(/\\/g, '/'));
      }
    } else if (JPEG.test(ent.name)) {
      out.push(ent.name);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }));
}

const apply = process.argv.includes('--apply');

function main() {
  const rels = collectRels();
  if (!rels.length) {
    console.log(`未找到 JPEG：${HAND}`);
    process.exit(0);
  }
  const counts = {};
  const plan = [];
  for (const rel of rels) {
    const sid = sectionIdForRel(rel);
    counts[sid] = (counts[sid] || 0) + 1;
    const n = counts[sid];
    const base = `${sid}_${String(n).padStart(3, '0')}.jpg`;
    const dir = path.dirname(rel);
    const targetRel = dir === '.' ? base : `${dir}/${base}`;
    if (rel === targetRel) continue;
    plan.push({ from: rel, to: targetRel, sid });
  }
  if (!plan.length) {
    console.log('所有文件已符合 {series}_{nnn}.jpg 命名，无需重命名。');
    return;
  }
  for (const { from, to, sid } of plan) {
    console.log(`${from}  →  ${to}  [${sid}]`);
  }
  if (!apply) {
    console.log(`\n共 ${plan.length} 项。添加 --apply 执行重命名。`);
    return;
  }
  for (const { from, to } of plan) {
    const absFrom = path.join(HAND, ...from.split('/'));
    const absTo = path.join(HAND, ...to.split('/'));
    const dirTo = path.dirname(absTo);
    if (!fs.existsSync(dirTo)) fs.mkdirSync(dirTo, { recursive: true });
    if (fs.existsSync(absTo)) {
      console.error('目标已存在，跳过:', to);
      continue;
    }
    fs.renameSync(absFrom, absTo);
  }
  console.log('重命名完成。');
}

main();
