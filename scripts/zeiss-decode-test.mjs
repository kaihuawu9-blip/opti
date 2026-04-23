/**
 * 诊断 PDF 抽取文本的实际字节与可能的编码形式
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const raw = JSON.parse(
  await fs.readFile(
    path.resolve('ai-data/zeiss_digital_handbook/2026_pricelist_raw.json'),
    'utf8',
  ),
);

const samples = [1, 3, 5, 40, 82];
for (const pageNo of samples) {
  const p = raw.pages.find((x) => x.page === pageNo);
  if (!p) continue;
  const snippet = p.text.replace(/\n/g, ' ').slice(0, 80);
  const codes = [...snippet.slice(0, 15)]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).padStart(4, '0')}`)
    .join(' ');

  // 尝试：把当前字符串当 UTF-8，重新按 GBK/GB18030 解码
  const bytes = Buffer.from(snippet, 'utf8');
  const tryGbk = new TextDecoder('gb18030').decode(bytes);

  // 反过来：把当前字符串当 GBK，解出字节再按 UTF-8 读
  const bytesGbk = Buffer.from(
    Array.from(snippet).map((ch) => {
      // 把字符按 GBK 编码，只取第一次：用 iconv 风格
      const buf = Buffer.from(ch, 'binary');
      return buf;
    }).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0)),
  );
  const tryRaw = Buffer.from(snippet, 'binary').toString('utf8');

  console.log(`\n=== page ${pageNo} ===`);
  console.log('orig :', snippet);
  console.log('codes:', codes);
  console.log('u8→gbk:', tryGbk);
  console.log('bin→u8:', tryRaw);
}
