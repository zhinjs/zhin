import { createMessages, type Locale } from 'zhin.js/i18n';
import type { MusicSource } from './types.js';
import { SOURCE_DISPLAY_NAME } from './config.js';
export const messages = createMessages({
  loginAborted: { 'zh-CN': '登录已取消', en: 'Login cancelled.' },
  keyword: { 'zh-CN': "请输入歌曲名称", en: "Enter a song name." },
  usage: { 'zh-CN': "用法：{command}", en: "Usage: {command}" },
  sources: { 'zh-CN': "支持音乐源：{sources}", en: "Music sources: {sources}" },
  noResults: { 'zh-CN': "[{source}] 未找到相关歌曲", en: "[{source}] No matching songs found." },
  noMatch: { 'zh-CN': "[{source}] 未找到\"{keyword}\"相关歌曲", en: "[{source}] No songs found for \"{keyword}\"." },
  results: { 'zh-CN': "[{source}] 搜索结果：\n{lines}\n\n回复序号播放，回复\"取消\"取消选择", en: "[{source}] Search results:\n{lines}\n\nReply with a number to play, or \"cancel\" to cancel." },
  unsupported: { 'zh-CN': "不支持的音乐源：{source}", en: "Unsupported music source: {source}" },
  cancelSelection: { 'zh-CN': "已取消点歌", en: "Music selection cancelled." },
  detailFailed: { 'zh-CN': "[{source}] 获取\"{title}\"播放信息失败：{error}", en: "[{source}] Could not load \"{title}\": {error}" },
  credentials: { 'zh-CN': "--- 音乐凭证状态 ---", en: "--- Music credentials ---" },
  unset: { 'zh-CN': "未配置", en: "Not configured" },
  count: { 'zh-CN': "{keys} ({count} 项)", en: "{keys} ({count} entries)" },
  credentialUnset: { 'zh-CN': "[{source}] 凭证 {key} 未设置", en: "[{source}] Credential {key} is not set." },
  saved: { 'zh-CN': "[{source}] 凭证 {key} 已保存", en: "[{source}] Credential {key} saved." },
  deleted: { 'zh-CN': "[{source}] 凭证 {key} 已删除", en: "[{source}] Credential {key} deleted." },
  conversation: { 'zh-CN': "无法识别会话信息，请在群聊或私聊中使用", en: "Cannot identify this conversation. Use a group or private chat." },
  cancelLogin: { 'zh-CN': "已取消登录", en: "Login cancelled." },
  noLogin: { 'zh-CN': "没有进行中的登录会话", en: "There is no active login session." },
  platform: { 'zh-CN': "不支持的平台：{platform}\n支持：qq, netease", en: "Unsupported platform: {platform}\nSupported: qq, netease" },
  active: { 'zh-CN': "正在进行 {source} 登录，请先完成", en: "A {source} login is in progress. Complete it first." },
  cancelHint: { 'zh-CN': "发送\"{command}\"可中止", en: "Send \"{command}\" to cancel." },
  qrFailed: { 'zh-CN': "[{source}] 获取二维码失败：{error}", en: "[{source}] Could not obtain a QR code: {error}" },
  noReply: { 'zh-CN': "无法发送消息", en: "Cannot send a reply." },
  scan: { 'zh-CN': "[{source}] 请使用 {source} App 扫描二维码登录：", en: "[{source}] Scan the QR code with the {source} app to sign in:" },
  valid: { 'zh-CN': "二维码有效期 2 分钟", en: "The QR code is valid for 2 minutes." },
  success: { 'zh-CN': "登录成功！cookie 已自动保存，现在可以搜索和播放高品质音乐了", en: "Signed in. The cookie has been saved; you can now search and play high-quality music." },
  waiting: { 'zh-CN': "等待扫码...", en: "Waiting for scan..." },
  scanned: { 'zh-CN': "已扫码，请在手机上确认登录", en: "Scanned. Confirm the login on your phone." },
  expired: { 'zh-CN': "二维码已过期，请重新发起登录", en: "The QR code has expired. Start a new login." },
  confirmed: { 'zh-CN': "登录成功", en: "Signed in." },
  unknown: { 'zh-CN': "未知状态", en: "Unknown status" },
  pollFailed: { 'zh-CN': "轮询失败：{error}", en: "Login polling failed: {error}" },
  pollError: { 'zh-CN': "轮询异常：{error}", en: "Login polling error: {error}" },
  timeout: { 'zh-CN': "登录超时，请重试", en: "Login timed out. Try again." },
  neteaseQr: { 'zh-CN': "获取网易云登录二维码失败", en: "Could not obtain a NetEase login QR code." },
  emptyResponse: { 'zh-CN': "服务端返回空响应 (HTTP {status})", en: "The server returned an empty response (HTTP {status})." },
  cookieFailed: { 'zh-CN': "登录成功但获取 cookie 失败", en: "Signed in, but could not retrieve the cookie." },
});
const EN_SOURCE_NAMES: Record<MusicSource, string> = { qq: 'QQ Music', netease: 'NetEase Cloud Music', kuwo: 'Kuwo', kugou: 'Kugou' };
export function sourceName(source: MusicSource, locale: Locale = 'zh-CN'): string {
  return locale === 'en' ? EN_SOURCE_NAMES[source] : SOURCE_DISPLAY_NAME[source];
}
export function usage(locale: Locale, command: string | undefined): string {
  return command === undefined ? '' : messages(locale, 'usage', { command });
}
