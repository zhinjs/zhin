import { jsonResponse } from '@zhin.js/host-http-contract';

/**
 * 400 for a `?locale=` that `queryLocale` rejects (#1250 batch 77). Every Console route — the
 * instance routes and the Host's own marketplace search — answers an unsupported or repeated value
 * with this one bilingual body, never with a silent default.
 */
export function invalidLocaleResponse(): Response {
  return jsonResponse(400, {
    success: false,
    code: 'invalid_locale',
    error: 'locale 只能是 zh-CN 或 en（locale must be zh-CN or en）',
  });
}
