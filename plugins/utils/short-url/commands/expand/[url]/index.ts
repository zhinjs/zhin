import { defineCommand } from 'zhin.js/command';
import { messages as t } from '../../../src/i18n.js';
import { expandUrl, isValidUrl } from '../../../src/short-url-lib.js';

export default defineCommand({
  description: '展开一个短链接，显示原始地址', descriptionI18n: { en: "Expand a short link to its original URL" },
  params: { url: { type: 'string' } },
  async execute({ params, locale }) {
    const url = String(params.url ?? '');
    if (!isValidUrl(url)) return t(locale, 'invalid');
    try {
      const original = await expandUrl(url, locale);
      return t(locale, 'expanded', { url: original });
    } catch (e: unknown) {
      return t(locale, 'expandFailed', { detail: e instanceof Error ? e.message : String(e) });
    }
  },
});
