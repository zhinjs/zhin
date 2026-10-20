import { stop } from '@pixel.js/shotium';
import { createHtmlRenderer } from '../src/index.ts';

const renderer = createHtmlRenderer({ width: 240, cacheDir: 'off' });
const html = '<div style="width:240px;height:96px;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#eff6ff"><div style="background:#bfdbfe"></div><div style="background:#dbeafe"></div></div>';
const results = [];
try {
  for (const format of ['png', 'jpeg', 'webp']) {
    const result = await renderer.render(html, { format });
    results.push({ ...result, data: result.data.toString('base64') });
  }
  console.log(JSON.stringify(results));
} finally {
  await stop();
}
