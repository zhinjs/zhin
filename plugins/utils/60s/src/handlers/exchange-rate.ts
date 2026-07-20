import { asArray, asRecord, asString, fetchApi } from '../api.js';

export default async function (args: { from?: string; to?: string }) {
  const params: Record<string, string> = {};
  if (args.from) params.from = args.from.toUpperCase();
  if (args.to) params.to = args.to.toUpperCase();
  const data = await fetchApi(
    '/exchange-rate',
    Object.keys(params).length ? params : undefined,
  );
  const lines = ['💱 汇率查询', ''];
  const base = data.base_code || args.from || 'CNY';
  lines.push(`基准货币: ${base}`);
  if (data.updated) lines.push(`更新时间: ${data.updated}`);
  lines.push('');
  const rates = asArray(data.rates);
  const targetCurrencies = args.to
    ? [args.to.toUpperCase()]
    : ['USD', 'EUR', 'JPY', 'GBP', 'HKD', 'KRW', 'AUD', 'CAD', 'SGD', 'CHF'];
  rates.forEach((item) => {
    const row = asRecord(item);
    const currency = asString(row.currency);
    if (targetCurrencies.includes(currency) && currency !== base) {
      lines.push(`${base} → ${currency}: ${row.rate}`);
    }
  });
  return lines.join('\n');
}
