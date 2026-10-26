import { messages as t, sourceName, usage } from '../../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { musicRuntimeToken } from '../../../../src/runtime.js';
import type { MusicSource } from '../../../../src/types.js';

const VALID_SOURCES = new Set<string>(['qq', 'netease', 'kuwo', 'kugou']);

export default defineCommand({
  description: '查看音乐平台凭证（脱敏）', descriptionI18n: { en: "View music platform credentials with sensitive values masked" },
  alias: ['查看'],
  params: { source: { type: 'string', description: '音乐源（qq/netease/kuwo/kugou）', descriptionI18n: { en: "Music source (qq / netease / kuwo / kugou)" } } },
  permit: ['role(master)'],
  async execute({ params, args, use, locale, formatCommand }) {
    const source = String(params.source ?? '').trim();
    const key = String(args[0] ?? '').trim();

    if (!VALID_SOURCES.has(source)) {
      return t(locale, 'unsupported', { source });
    }
    if (!key) {
      const command = formatCommand('cookie get');
      return usage(locale, command === undefined ? undefined : `${command} ${source} <key>`);
    }

    const label = sourceName(source as MusicSource, locale);
    const value = await use(musicRuntimeToken).credentials.get(source as MusicSource, key);
    if (!value) return t(locale, 'credentialUnset', { source: label, key });

    const masked = value.length > 10
      ? `${value.slice(0, 4)}****${value.slice(-4)}`
      : '****';
    return `[${label}] ${key} = ${masked}`;
  },
});
