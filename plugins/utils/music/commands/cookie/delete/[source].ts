import { defineCommand } from '@zhin.js/command';
import { deleteCredential } from '../../../src/credential-store.js';
import { SOURCE_DISPLAY_NAME } from '../../../src/config.js';
import type { MusicSource } from '../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '删除音乐平台凭证',
  alias: ['删除'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）' } },
  permit: ['role(master)'],
  async execute({ params, args }) {
    const source = String(params.source ?? '').trim();
    const key = String(args[0] ?? '').trim();

    if (!VALID_SOURCES.has(source)) {
      return `不支持的音乐源：${source}`;
    }
    if (!key) {
      return `格式：cookie delete ${source} <key>`;
    }

    await deleteCredential(source as MusicSource, key);
    return `[${SOURCE_DISPLAY_NAME[source as MusicSource]}] 凭证 ${key} 已删除`;
  },
});
