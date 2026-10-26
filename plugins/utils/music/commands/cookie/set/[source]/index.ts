import { messages as t, sourceName, usage } from '../../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { musicRuntimeToken } from '../../../../src/runtime.js';
import type { MusicSource } from '../../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '保存音乐平台凭证', descriptionI18n: { en: "Save music platform credentials" },
  alias: ['设置'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）', descriptionI18n: { en: "Music source (qq / netease / kuwo / kugou)" } } },
  permit: ['role(master)'],
  async execute({ params, args, use, locale, formatCommand }) {
    const source = String(params.source ?? '').trim();
    const [key, ...valueParts] = args.map(String);

    if (!VALID_SOURCES.has(source)) {
      return t(locale, 'unsupported', { source }) + '\n' + t(locale, 'sources', { sources: [...VALID_SOURCES].join(', ') });
    }
    if (!key || valueParts.length === 0) {
      const command = formatCommand('cookie set');
      return usage(locale, command === undefined ? undefined : `${command} ${source} <key> <value>`);
    }

    await use(musicRuntimeToken).credentials.set(source as MusicSource, key, valueParts.join(' '));
    return t(locale, 'saved', { source: sourceName(source as MusicSource, locale), key });
  },
});
