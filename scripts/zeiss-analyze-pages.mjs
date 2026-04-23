/**
 * 扫描每页文本可读性 + 尝试提取价格行
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const raw = JSON.parse(
  await fs.readFile(
    path.resolve('ai-data/zeiss_digital_handbook/2026_pricelist_raw.json'),
    'utf8',
  ),
);

const out = [];
for (const p of raw.pages) {
  const text = p.text || '';
  const hasCJK = /[\u4e00-\u9fff]/.test(text);
  // CID 占位（私用区 + 不寻常的 Unicode 字段）
  const cidCharCount = [...text].filter((ch) => {
    const cp = ch.codePointAt(0);
    return (
      (cp >= 0x2000 && cp <= 0x2fff) ||
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xe000 && cp <= 0xf8ff) ||
      (cp >= 0xff00 && cp <= 0xffef && !/[a-zA-Z0-9]/.test(ch))
    );
  }).length;
  const cjkCharCount = [...text].filter((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x4e00 && cp <= 0x9fff;
  }).length;
  // 更可靠：页面里必须至少命中几个预期的蔡司/视光高频词，否则视为 CID 乱码
  const expectedTerms = [
    '蔡司', '单光', '渐进', '折射率', '膜', '镜片', '钻立方',
    '铂金', '防蓝光', '价格', '系列', '成长', '数码', '驾驶',
    '办公', '智锐', '泽锐', '清锐', '盛锐', '博锐', '染色',
    '莲花', '悦慕', '小乐圆', '旗舰', '标配', '时尚',
  ];
  const termHits = expectedTerms.filter((t) => text.includes(t)).length;
  const readable = hasCJK && termHits >= 1;

  // 价格行：提取 "¥XXXX" / "￥XXXX" / 裸数字靠近品名
  const priceHits = [...text.matchAll(/[¥￥]\s*([0-9][0-9,，]{2,})/g)].map(
    (m) => Number(m[1].replace(/[,，]/g, '')),
  );
  // 折射率
  const indexHits = [
    ...new Set(
      [...text.matchAll(/(?<![\d.])(1\.50|1\.56|1\.6|1\.60|1\.67|1\.74|1\.71)(?![\d])/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  out.push({
    page: p.page,
    readable,
    cjk: cjkCharCount,
    cid: cidCharCount,
    priceHits,
    indexHits,
    headSample: text
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120),
  });
}

const unreadable = out.filter((x) => !x.readable).map((x) => x.page);
console.log(`总页数: ${out.length}`);
console.log(`不可直接机读的页面（CID 占位）: ${unreadable.join(', ')}`);
console.log(
  `可机读且含价格的页面: ${out
    .filter((x) => x.readable && x.priceHits.length > 0)
    .map((x) => `P${x.page}(${x.priceHits.length}价)`)
    .join(', ')}`,
);

await fs.writeFile(
  path.resolve('ai-data/zeiss_digital_handbook/_page_analysis.json'),
  JSON.stringify(out, null, 2),
);
console.log(`→ ai-data/zeiss_digital_handbook/_page_analysis.json`);
