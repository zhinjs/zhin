import { createMessages, type Locale } from 'zhin.js/i18n';

const catalog = {
  timezone: { 'zh-CN': '未知时区：{value}', en: 'Unknown timezone: {value}' },
  datetime: { 'zh-CN': '无法解析时间：{value}', en: 'Could not parse datetime: {value}' },
  datetimeFormat: { 'zh-CN': '无法解析时间：{value}（请用 YYYY-MM-DDTHH:mm 格式）', en: 'Could not parse datetime: {value} (use YYYY-MM-DDTHH:mm)' },
  duration: { 'zh-CN': '无法解析时长：{value}（示例：10m、2h30m、1d）', en: 'Could not parse duration: {value} (examples: 10m, 2h30m, 1d)' },
  workTime: { 'zh-CN': '工作时间格式无效：{value}（示例：09:00）', en: 'Invalid work time: {value} (example: 09:00)' },
  positiveDuration: { 'zh-CN': '时长必须大于 0 分钟', en: 'Duration must be greater than 0 minutes' },
  listHttp: { 'zh-CN': '{provider} 列表失败：HTTP {status} {detail}', en: '{provider} could not list events: HTTP {status} {detail}' },
  createHttp: { 'zh-CN': '{provider} 创建失败：HTTP {status}', en: '{provider} could not create the event: HTTP {status}' },
  caldavHttp: { 'zh-CN': 'CalDAV {method} 失败：HTTP {status}', en: 'CalDAV {method} failed: HTTP {status}' },
  exchange: { 'zh-CN': '{provider}: 换取 token 失败：{detail}', en: '{provider}: token exchange failed: {detail}' },
  refreshMissing: { 'zh-CN': '{provider}: 响应没有 refresh_token。Google 请确认 access_type=offline&prompt=consent；Microsoft 请确认已请求 offline_access。', en: '{provider}: the response has no refresh_token. For Google, check access_type=offline&prompt=consent; for Microsoft, request offline_access.' },
  accessMissing: { 'zh-CN': '{provider}: 响应缺少 access_token', en: '{provider}: the response has no access_token' },
  clientMissing: { 'zh-CN': '{provider}: 缺少 {field}', en: '{provider}: missing {field}' },
  refreshHttp: { 'zh-CN': '{provider}: token 刷新失败 HTTP {status}：{detail}', en: '{provider}: token refresh failed, HTTP {status}: {detail}' },
  refreshAccessMissing: { 'zh-CN': '{provider}: 刷新响应缺少 access_token', en: '{provider}: the refresh response has no access_token' },
} as const;
const messages = createMessages(catalog);

/** Calendar-owned failures retain their code and raw parameters until presentation. */
export class CalendarError extends Error {
  readonly code: keyof typeof catalog;
  readonly params: Readonly<Record<string, string | number>>;

  constructor(code: keyof typeof catalog, params: Readonly<Record<string, string | number>> = {}, locale?: Locale) {
    super(messages(locale, code, params));
    this.name = 'CalendarError';
    this.code = code;
    this.params = params;
  }
  format(locale?: Locale): string { return messages(locale, this.code, this.params); }
}
