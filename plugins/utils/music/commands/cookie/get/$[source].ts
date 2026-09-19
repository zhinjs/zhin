import { defineCommand } from 'zhin.js/command';
import { getCredential } from '../../../src/credential-store.js';
import { SOURCE_DISPLAY_NAME } from '../../../src/config.js';
import type { MusicSource } from '../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '查看音乐平台凭证（脱敏）',
  alias: ['查看'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）' } },
  permit: ['role(master)'],
  async execute({ params, args }) {
    const source = String(params.source ?? '').trim();
    const key = String(args[0] ?? '').trim();

    if (!VALID_SOURCES.has(source)) {
      return `不支持的音乐源：${source}`;
    }
    if (!key) {
      return `格式：cookie get ${source} <key>`;
    }

    const sourceName = SOURCE_DISPLAY_NAME[source as MusicSource];
    const value = await getCredential(source as MusicSource, key);
    if (!value) return `[${sourceName}] 凭证 ${key} 未设置`;

    const masked = value.length > 10
      ? `${value.slice(0, 4)}****${value.slice(-4)}`
      : '****';
    return `[${sourceName}] ${key} = ${masked}`;
  },
});
