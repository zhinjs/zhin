import { defineCommand } from 'zhin.js/command';
import { renderRecentEarthquakes } from '../../src/query-text.js';
import { earthquakeServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '查询最近的地震（CENC 中国地震台网 / USGS）',
  params: {
    count: { type: 'integer', optional: true, min: 1, max: 20, description: '列出条数' },
  },
  options: {
    min: { type: 'float', alias: 'm', min: 0, max: 10, description: '最小震级' },
    region: { type: 'string', alias: 'r', description: '地区关键词，如 四川、日本、中国' },
    hours: { type: 'integer', alias: 'h', min: 1, max: 168, description: '时间范围（小时），默认 24' },
  },
  execution: { cooldownMs: 5_000, progressAfterMs: 3_000 },
  async execute({ params, options, use }) {
    const service = use(earthquakeServiceToken);
    return renderRecentEarthquakes(service, {
      limit: params.count,
      minMagnitude: options.min,
      region: options.region,
      hours: options.hours,
    });
  },
});
