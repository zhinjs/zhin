import { defineCommand } from 'zhin.js/command';
import { musicRuntimeToken } from '../../../src/runtime.js';
import { messages as t, sourceName } from '../../../src/i18n.js';
import type { MusicSource } from '../../../src/types.js';

export default defineCommand({
  description: '查看各平台凭证配置状态', descriptionI18n: { en: "View configured music credentials by platform" },
  alias: ['状态'],
  permit: ['role(master)'],
  async execute({ use, locale }) {
    const allCreds = await use(musicRuntimeToken).credentials.list();
    const lines: string[] = [t(locale, 'credentials')];
    for (const source of ['qq', 'netease', 'kuwo', 'kugou'] as MusicSource[]) {
      const name = sourceName(source, locale);
      const creds = allCreds.filter((c) => c.source === source);
      if (creds.length === 0) {
        lines.push(`${name}: ${t(locale, 'unset')}`);
      } else {
        const keys = creds.map((c) => c.key).join(', ');
        lines.push(`${name}: ${t(locale, 'count', { keys, count: creds.length })}`);
      }
    }
    return lines.join('\n');
  },
});
