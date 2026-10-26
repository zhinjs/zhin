import { defineCommand } from 'zhin.js/command';
import { renderRecentEarthquakes } from '../../src/query-text.js';
import { earthquakeServiceToken } from '../../src/runtime.js';

export default defineCommand({
  alias: ['earthquake'],
  preferredAliasI18n: { en: 'earthquake' },
  description: '查询最近的地震（CENC 中国地震台网 / USGS）', descriptionI18n: { en: "Recent earthquakes from CENC or USGS" },
  params: {
    count: { type: 'integer', optional: true, min: 1, max: 20, description: '列出条数', descriptionI18n: { en: "Number of results" } },
  },
  options: {
    min: { type: 'float', alias: 'm', min: 0, max: 10, description: '最小震级', descriptionI18n: { en: "Minimum magnitude" } },
    region: { type: 'string', alias: 'r', description: '地区关键词，如 四川、日本、中国', descriptionI18n: { en: "Region keywords, such as Sichuan, Japan or China" } },
    hours: { type: 'integer', alias: 't', min: 1, max: 168, description: '时间范围（小时），默认 24', descriptionI18n: { en: "Time range in hours (default: 24)" } },
  },
  execution: { cooldownMs: 5_000, progressAfterMs: 3_000 },
  async execute({ params, options, use, locale }) {
    const service = use(earthquakeServiceToken);
    return renderRecentEarthquakes(service, {
      limit: params.count,
      minMagnitude: options.min,
      region: options.region,
      hours: options.hours,
    }, locale);
  },
});
