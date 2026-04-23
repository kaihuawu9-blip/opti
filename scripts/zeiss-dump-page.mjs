import fs from 'node:fs/promises';
import path from 'node:path';

const targets = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '40', '82']
).map((n) => Number(n));

const raw = JSON.parse(
  await fs.readFile(
    path.resolve('ai-data/zeiss_digital_handbook/2026_pricelist_raw.json'),
    'utf8',
  ),
);

for (const p of raw.pages) {
  if (!targets.includes(p.page)) continue;
  console.log('\n==================== PAGE', p.page, '====================');
  console.log(p.text);
}
