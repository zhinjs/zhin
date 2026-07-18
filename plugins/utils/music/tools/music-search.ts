import { defineAgentTool } from '@zhin.js/tool';
import { searchMusic } from '../src/music-lib.js';
import type { MusicSource } from '../src/types.js';

export default defineAgentTool<{
  keyword: string;
  source?: MusicSource;
  limit?: number;
}>({
  description: '搜索音乐并返回结果列表',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
      source: { type: 'string', enum: ['qq', 'netease'] },
      limit: { type: 'number', description: '返回结果数量（默认 5）' },
    },
    required: ['keyword'],
  },
  approval: 'never',
  execute: ({ keyword, source, limit }) =>
    searchMusic(String(keyword), source, typeof limit === 'number' ? limit : 5),
});
