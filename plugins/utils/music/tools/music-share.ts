import { defineAgentTool } from '@zhin.js/tool';
import { shareMusicDetail } from '../src/music-lib.js';
import type { MusicSource } from '../src/types.js';

export default defineAgentTool<{
  id: string;
  source: MusicSource;
}>({
  description: '分享指定的音乐（支持QQ/网易云/酷我/酷狗）',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '音乐 ID' },
      source: {
        type: 'string',
        enum: ['qq', 'netease', 'kuwo', 'kugou'],
        description: '音乐源',
      },
    },
    required: ['id', 'source'],
  },
  approval: 'never',
  execute: ({ id, source }) => shareMusicDetail(String(id), source),
});
