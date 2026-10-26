import { defineCommand } from 'zhin.js/command';
import { messages as t } from '../../../src/i18n.js';
import { isValidUrl, shortenUrl } from '../../../src/short-url-lib.js';

export default defineCommand({
  description: '缩短一个 URL', descriptionI18n: { en: "Shorten a URL" },
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
