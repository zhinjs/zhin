import { fetchApi } from './_api.js';

export default async function () {
  const data = await fetchApi<any>('/bing');
  const lines = ['🖼️ Bing 每日壁纸', ''];
  if (data.title) lines.push(`📌 ${data.title}`);
  if (data.headline) lines.push(`💡 ${data.headline}`);
  if (data.copyright) lines.push(`📝 ${data.copyright}`);
  if (data.description) lines.push('', data.description);
  const imgUrl = data.cover || data.cover_4k || data.url || data.image;
  if (imgUrl) lines.push('', imgUrl);
  return lines.join('\n');
}
