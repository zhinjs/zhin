import { defineAgentTool } from '@zhin.js/tool';
import { shareMusicDetail } from '../src/music-lib.js';
import type { MusicSource } from '../src/types.js';

export default defineAgentTool<{
  id: string;
  source: MusicSource;
}>({
  description: '分享指定的音乐',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '音乐 ID' },
      source: { type: 'string', enum: ['qq', 'netease'] },
    },
    required: ['id', 'source'],
  },
  approval: 'never',
  execute: ({ id, source }) => shareMusicDetail(String(id), source),
});
