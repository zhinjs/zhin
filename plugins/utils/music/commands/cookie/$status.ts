import { defineCommand } from 'zhin.js/command';
import { musicRuntimeToken } from '../../src/runtime.js';
import { SOURCE_DISPLAY_NAME } from '../../src/config.js';
import type { MusicSource } from '../../src/types.js';

export default defineCommand({
  description: '查看各平台凭证配置状态',
  alias: ['状态'],
  permit: ['role(master)'],
  async execute({ use }) {
    const allCreds = await use(musicRuntimeToken).credentials.list();
    const lines: string[] = ['--- 音乐凭证状态 ---'];
    for (const source of ['qq', 'netease', 'kuwo', 'kugou'] as MusicSource[]) {
      const name = SOURCE_DISPLAY_NAME[source];
      const creds = allCreds.filter((c) => c.source === source);
      if (creds.length === 0) {
        lines.push(`${name}: 未配置`);
      } else {
        const keys = creds.map((c) => c.key).join(', ');
        lines.push(`${name}: ${keys} (${creds.length} 项)`);
      }
    }
    return lines.join('\n');
  },
});
