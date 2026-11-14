import { defineCommand } from 'zhin.js/command';
import { messages as t } from '../../../src/i18n.js';
import { isValidUrl, shortenUrl } from '../../../src/short-url-lib.js';

export default defineCommand({
  description: '缩短一个 URL', descriptionI18n: { en: "Shorten a URL" },
  // Not bare `short` / `短链`: routing does not check that the argument is a URL, so
  // `短链 是什么` would be taken as a command; `生成短链` is unambiguous.
  alias: ['生成短链'],
  preferredAliasI18n: { 'zh-CN': '生成短链' },
  params: { url: { type: 'string' } },
  async execute({ params, locale }) {
    const url = String(params.url ?? '');
    if (!isValidUrl(url)) return t(locale, 'invalid');
    try {
      const short = await shortenUrl(url, locale);
      return t(locale, 'shortened', { url: short });
    } catch (e: unknown) {
      return t(locale, 'shortFailed', { detail: e instanceof Error ? e.message : String(e) });
    }
  },
});
