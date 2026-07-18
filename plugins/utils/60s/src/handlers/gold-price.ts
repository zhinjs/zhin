import { asArray, asRecord, fetchApi } from '../api.js';

export default async function () {
  const data = await fetchApi('/gold-price');
  const lines = ['💰 今日金价', ''];
  if (data.date) lines.push(`📅 ${data.date}`);
  const metals = asArray(data.metals);
  if (metals.length > 0) {
    lines.push('');
    metals.forEach((item) => {
      const row = asRecord(item);
      const name = row.name || '黄金';
      const price = row.today_price || row.sell_price || row.price || 'N/A';
      const unit = row.unit || '元/克';
      if (price !== 'N/A') lines.push(`${name}: ¥${price} ${unit}`);
    });
  } else if (data.price) {
    lines.push(`当前金价: ¥${data.price}/克`);
  }
  return lines.join('\n');
}
