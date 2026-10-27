/** `bili-login` 命令的文案；扫码与凭据保存仍由 endpoint 负责。 */
import { createMessages, type Locale } from 'zhin.js/i18n';
import type { BilibiliEndpointRegistry } from './bilibili-runtime-state.js';
import type { BilibiliEndpoint } from './endpoint.js';

const t = createMessages({
  none: { 'zh-CN': 'B 站适配器还没有启动', en: 'The Bilibili adapter has not started.' },
  pick: { 'zh-CN': '有多个账号：{ids}。请在命令后写上账号名', en: 'Several accounts are configured: {ids}. Add the account name to the command.' },
  missing: { 'zh-CN': '找不到账号 {id}', en: 'Account {id} was not found.' },
  ok: { 'zh-CN': '[{id}] 已登录：{name}（{source}）', en: '[{id}] Signed in: {name} ({source})' },
  expired: { 'zh-CN': '[{id}] 登录已失效，请重新扫码', en: '[{id}] Login expired; scan the QR code again.' },
  anonymous: { 'zh-CN': '[{id}] 未登录（只读轮询公开评论，无法发送）', en: '[{id}] Not signed in (public comments are read-only; sending is unavailable).' },
  sourceConfig: { 'zh-CN': 'Cookie 来自配置 / 环境变量', en: 'cookie from config or environment' },
  sourceQr: { 'zh-CN': '扫码登录', en: 'QR login' },
  expires: { 'zh-CN': '，{date} 过期', en: ', expires {date}' },
  drafts: { 'zh-CN': '待审草稿 {count} 条', en: '{count} drafts awaiting review' },
  privateOnly: { 'zh-CN': '登录二维码只能在私聊里发，避免别人看到。请私聊机器人再试，或用 Console「评论审批」页', en: 'The login QR code is only sent in private chats so others cannot see it. Message the bot privately or use the Console "Comment review" page.' },
  configOk: { 'zh-CN': '[{id}] 已用配置里的 Cookie 登录，无需扫码。要改用扫码，请先去掉 sessdata / biliJct 配置', en: '[{id}] Already signed in with the configured cookie. Remove sessdata / biliJct from the config to use QR login instead.' },
  scan: { 'zh-CN': '用 B 站 App 扫码登录（约 3 分钟内有效，登录后凭据只存在本机数据目录）：', en: 'Scan with the Bilibili app to sign in (valid for about 3 minutes; credentials stay in the local data directory):' },
  failed: { 'zh-CN': '获取二维码失败：{error}', en: 'Could not get a QR code: {error}' },
  after: { 'zh-CN': '扫码后发 {command} 查看结果', en: 'After scanning, send {command} to check the result.' },
});

export function pickLoginEndpoint(registry: BilibiliEndpointRegistry, id: string | undefined, locale?: Locale): BilibiliEndpoint | string {
  if (id) return registry.get(id) ?? t(locale, 'missing', { id });
  const endpoints = [...registry.values()];
  if (endpoints.length === 0) return t(locale, 'none');
  if (endpoints.length > 1) return t(locale, 'pick', { ids: endpoints.map(endpoint => endpoint.localId).join(', ') });
  return endpoints[0]!;
}

export function loginStatusLine(endpoint: BilibiliEndpoint, locale?: Locale): string {
  const id = endpoint.localId;
  const login = endpoint.login;
  const base = login.state === 'ok'
    ? t(locale, 'ok', {
      id,
      name: login.uname ? `${login.uname} (uid ${login.mid})` : `uid ${login.mid}`,
      source: t(locale, login.source === 'config' ? 'sourceConfig' : 'sourceQr'),
    }) + (login.expiresAt ? t(locale, 'expires', { date: new Date(login.expiresAt).toISOString().slice(0, 10) }) : '')
    : t(locale, login.state === 'expired' ? 'expired' : 'anonymous', { id });
  return `${base}\n${t(locale, 'drafts', { count: endpoint.drafts.size })}`;
}

export function loginStatusText(registry: BilibiliEndpointRegistry, locale?: Locale): string {
  const endpoints = [...registry.values()];
  if (endpoints.length === 0) return t(locale, 'none');
  return endpoints.map(endpoint => loginStatusLine(endpoint, locale)).join('\n\n');
}

export type LoginStartResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'qr'; readonly text: string; readonly image: string; readonly hint?: string };

export async function startLoginForChat(
  registry: BilibiliEndpointRegistry,
  options: { readonly id?: string; readonly locale?: Locale; readonly isPrivate: boolean; readonly statusCommand?: string },
): Promise<LoginStartResult> {
  const { locale } = options;
  if (!options.isPrivate) return { kind: 'text', text: t(locale, 'privateOnly') };
  const endpoint = pickLoginEndpoint(registry, options.id, locale);
  if (typeof endpoint === 'string') return { kind: 'text', text: endpoint };
  if (endpoint.login.state === 'ok' && endpoint.login.source === 'config') {
    return { kind: 'text', text: t(locale, 'configOk', { id: endpoint.localId }) };
  }
  const qr = await endpoint.startQrLogin();
  if (!qr.image || (qr.state !== 'waiting' && qr.state !== 'scanned')) {
    return { kind: 'text', text: t(locale, 'failed', { error: qr.error ?? qr.state }) };
  }
  return {
    kind: 'qr',
    text: t(locale, 'scan'),
    image: qr.image,
    ...(options.statusCommand ? { hint: t(locale, 'after', { command: options.statusCommand }) } : {}),
  };
}
