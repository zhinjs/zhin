import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { renderRecentEarthquakes } from '../../../../src/query-text.js';
import { earthquakeServiceToken } from '../../../../src/runtime.js';

interface RecentEarthquakesInput {
  readonly limit?: number;
  readonly minMagnitude?: number;
  readonly region?: string;
  readonly hours?: number;
}

export default defineAgentTool<RecentEarthquakesInput>({
  description: '查询最近发生的地震（中国地震台网 CENC 与 USGS 合并去重），可按最小震级、地区关键词和时间范围过滤',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional().describe('返回条数，默认 5'),
    minMagnitude: z.number().min(0).max(10).optional().describe('最小震级，默认 3'),
    region: z.string().max(20).optional().describe('地区关键词，如「四川」「日本」「Japan」；「中国」表示国内'),
    hours: z.number().int().min(1).max(168).optional().describe('时间范围（小时），默认 24'),
  }),
  keywords: ['地震', '震级', '余震', '地震速报', 'earthquake', 'quake', 'seismic'],
  tags: ['地震', '查询', '实时'],
  async execute({ limit, minMagnitude, region, hours }, context) {
    return renderRecentEarthquakes(context.use(earthquakeServiceToken), { limit, minMagnitude, region, hours }, context.locale);
  },
});
