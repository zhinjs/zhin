/** `juejin-login status` 命令的文案；Cookie 只来自配置 / 环境变量，这里不处理登录。 */
import { createMessages, type Locale } from 'zhin.js/i18n';
import type { JuejinEndpointDirectory, JuejinEndpointView } from './endpoint-directory.js';

const t = createMessages({
  none: { 'zh-CN': '掘金适配器还没有启动', en: 'The Juejin adapter has not started.' },
  ok: { 'zh-CN': '[{id}] 已登录：{name}（Cookie 来自配置 / 环境变量）', en: '[{id}] Signed in: {name} (cookie from config or environment)' },
  expired: { 'zh-CN': '[{id}] 登录已失效，请更新 JUEJIN_COOKIE 后重启', en: '[{id}] Login expired; update JUEJIN_COOKIE and restart.' },
  anonymous: { 'zh-CN': '[{id}] 未登录（只读轮询公开评论，无法发送）', en: '[{id}] Not signed in (public comments are read-only; sending is unavailable).' },
  drafts: { 'zh-CN': '待审草稿 {count} 条', en: '{count} drafts awaiting review' },
  circuit: { 'zh-CN': '已熔断（{code}），轮询与发送已停止', en: 'Circuit open ({code}); polling and sending are stopped' },
});

export function loginStatusLine(endpoint: JuejinEndpointView, locale?: Locale): string {
  const id = endpoint.localId;
  const login = endpoint.login;
  const base = login.state === 'ok'
    ? t(locale, 'ok', { id, name: login.userName ? `${login.userName} (uid ${login.userId})` : `uid ${login.userId}` })
    : t(locale, login.state === 'expired' ? 'expired' : 'anonymous', { id });
  const circuit = endpoint.circuitBreaker;
  return [base, ...(circuit ? [t(locale, 'circuit', { code: circuit.code })] : []), t(locale, 'drafts', { count: endpoint.drafts.size })].join('\n');
}

export function loginStatusText(registry: JuejinEndpointDirectory, locale?: Locale): string {
  const endpoints = [...registry.values()];
  if (endpoints.length === 0) return t(locale, 'none');
  return endpoints.map(endpoint => loginStatusLine(endpoint, locale)).join('\n\n');
}
