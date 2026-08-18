import { defineCommand } from '@zhin.js/command';
import { setCredential } from '../../../src/credential-store.js';
import { SOURCE_DISPLAY_NAME } from '../../../src/config.js';
import type { MusicSource } from '../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '保存音乐平台凭证',
  alias: ['设置'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）' } },
  permit: ['role(master)'],
  async execute({ params, args }) {
    const source = String(params.source ?? '').trim();
    const [key, ...valueParts] = args.map(String);

    if (!VALID_SOURCES.has(source)) {
      return `不支持的音乐源：${source}\n支持：${[...VALID_SOURCES].join(', ')}`;
    }
    if (!key || valueParts.length === 0) {
      return `格式：cookie set ${source} <key> <value>\n示例：cookie set netease cookie MUSIC_U=xxx`;
    }

    await setCredential(source as MusicSource, key, valueParts.join(' '));
    return `[${SOURCE_DISPLAY_NAME[source as MusicSource]}] 凭证 ${key} 已保存`;
  },
});
