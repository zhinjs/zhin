#!/usr/bin/env node
/**
 * 从 googlefonts/noto-cjk 拉取 Sans SubsetOTF（静态），写入 ../fonts/
 * - 与 Satori 0.12 所用 opentype 解析器兼容（不要用 Google Fonts 可变 TTF，会触发 fvar 解析崩溃）
 * - 避免误存成 GitHub HTML 页面导致中文全部豆腐块
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, '..', 'fonts');
const base =
  'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/SubsetOTF';

const files = [
  { out: 'NotoSansSC-Regular.otf', url: `${base}/SC/NotoSansSC-Regular.otf` },
  { out: 'NotoSansJP-Regular.otf', url: `${base}/JP/NotoSansJP-Regular.otf` },
  { out: 'NotoSansKR-Regular.otf', url: `${base}/KR/NotoSansKR-Regular.otf` },
];

mkdirSync(fontsDir, { recursive: true });

for (const { out, url } of files) {
  process.stderr.write(`Fetching ${out}...\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${out}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4).toString('utf8');
  if (head === '<!DO' || head === '<htm') {
    throw new Error(`${out}: response is HTML, not a font (check URL/network)`);
  }
  writeFileSync(join(fontsDir, out), buf);
  process.stderr.write(`Wrote ${out} (${(buf.length / 1024 / 1024).toFixed(2)} MB)\n`);
}
