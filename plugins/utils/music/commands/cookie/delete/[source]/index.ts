import { messages as t, sourceName, usage } from '../../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { musicRuntimeToken } from '../../../../src/runtime.js';
import type { MusicSource } from '../../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '删除音乐平台凭证', descriptionI18n: { en: "Delete music platform credentials" },
  alias: ['删除'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）', descriptionI18n: { en: "Music source (qq / netease / kuwo / kugou)" } } },
  permit: ['role(master)'],
  async execute({ params, args, use, locale, formatCommand }) {
    const source = String(params.source ?? '').trim();
    const key = String(args[0] ?? '').trim();

    if (!VALID_SOURCES.has(source)) {
      return t(locale, 'unsupported', { source });
    }
    if (!key) {
      const command = formatCommand('cookie delete');
      return usage(locale, command === undefined ? undefined : `${command} ${source} <key>`);
    }

    await use(musicRuntimeToken).credentials.delete(source as MusicSource, key);
    return t(locale, 'deleted', { source: sourceName(source as MusicSource, locale), key });
  },
});
