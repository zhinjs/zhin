import { jsonResponse } from '@zhin.js/host-http';

/**
 * 400 for a `?locale=` that `queryLocale` rejects (#1250 batch 77): every Console route parses the
 * query the same strict way, so an unsupported or repeated value is an error, never a silent default.
 */
export function invalidLocaleResponse(): Response {
  return jsonResponse(400, { success: false, code: 'invalid_locale', error: 'locale 只能是 zh-CN 或 en（locale must be zh-CN or en）' });
}
