import { fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi<any>('/gold-price');
  const lines = ['💰 今日金价', ''];
  if (data.date) lines.push(`📅 ${data.date}`);
  const metals = data.metals || (Array.isArray(data) ? data : []);
  if (metals.length > 0) {
    lines.push('');
    metals.forEach((item: any) => {
      const name = item.name || '黄金';
      const price = item.today_price || item.sell_price || item.price || 'N/A';
      const unit = item.unit || '元/克';
      if (price !== 'N/A') lines.push(`${name}: ¥${price} ${unit}`);
    });
  } else if (data.price) {
    lines.push(`当前金价: ¥${data.price}/克`);
  }
  return lines.join('\n');
}
