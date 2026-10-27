/** Draft review presentation; endpoint methods remain the approval and delivery authority. */
import { createMessages, type Locale } from 'zhin.js/i18n';
import type { BilibiliReplyDraft } from './drafts.js';
import { BilibiliReviewError, type BilibiliEndpoint, type BilibiliNotice } from './endpoint.js';
import type { BilibiliEndpointRegistry } from './bilibili-runtime-state.js';
import { BILIBILI_COMMENT_MAX_LENGTH } from './protocol.js';

const LIST_LIMIT = 10;
const t = createMessages({
  sending: { 'zh-CN': '（发送中）', en: ' (sending)' },
  interrupted: { 'zh-CN': '（上次发送中断，可能已经发出，请先到 B 站确认）', en: ' (last send was interrupted and may have been posted; check Bilibili first)' },
  noticeDraft: { 'zh-CN': 'B 站有一条新评论回复等你审批：', en: 'A new Bilibili comment reply is waiting for your approval:' },
  noticeReview: { 'zh-CN': '去 Console「评论审批」页处理，或：{command}', en: 'Review it on the Console "Comment review" page, or: {command}' },
  noticeReviewConsole: { 'zh-CN': '去 Console「评论审批」页处理', en: 'Review it on the Console "Comment review" page' },
  noticeExpired: { 'zh-CN': 'B 站登录已失效，暂时无法发送评论。请在 Console「评论审批」页扫码重新登录。', en: 'Your Bilibili login has expired, so replies cannot be posted. Scan the QR code again on the Console "Comment review" page.' },
  noticeExpiredConfig: { 'zh-CN': 'B 站登录已失效（Cookie 来自配置 / 环境变量）。请更新环境变量，或去掉它后在 Console「评论审批」页扫码登录。', en: 'Your Bilibili login has expired (cookie from config or environment). Update the environment variables, or remove them and scan the QR code on the Console "Comment review" page.' },
  noticeLoggedIn: { 'zh-CN': 'B 站扫码登录成功：{name}', en: 'Signed in to Bilibili: {name}' },
  original: { 'zh-CN': '  原评论 {author}：{text}', en: '  Original comment by {author}: {text}' },
  reply: { 'zh-CN': '  拟回复：{text}', en: '  Proposed reply: {text}' },
  empty: { 'zh-CN': '没有待审的 B 站评论草稿', en: 'No Bilibili comment drafts are awaiting review.' },
  more: { 'zh-CN': '（只显示最新 {shown} 条，共 {total} 条）', en: '(Showing the latest {shown} of {total} drafts)' },
  list: { 'zh-CN': '待审草稿 {count} 条：', en: '{count} drafts awaiting review:' },
  sendHint: { 'zh-CN': '发送：{command}', en: 'Send: {command}' },
  editHint: { 'zh-CN': '改写：{command}', en: 'Edit: {command}' },
  dropHint: { 'zh-CN': '丢弃：{command}', en: 'Discard: {command}' },
  content: { 'zh-CN': '<新内容>', en: '<new content>' },
  editUsage: { 'zh-CN': '用法：{command} <id> {content}', en: 'Usage: {command} <id> {content}' },
  editRequired: { 'zh-CN': '请提供草稿的新内容。当前环境无法确定改写指令的调用方式。', en: 'Provide new draft text. The edit command invocation is unavailable in this environment.' },
  missing: { 'zh-CN': '找不到草稿 {id}', en: 'Draft {id} was not found.' },
  edited: { 'zh-CN': '已改写，还没发出：', en: 'Updated; not sent yet:' },
  approveHint: { 'zh-CN': '确认无误后：{command}', en: 'After reviewing, approve with: {command}' },
  dropped: { 'zh-CN': '已丢弃草稿 {id}（未发送）', en: 'Draft {id} discarded without sending.' },
  sent: { 'zh-CN': '已发到 B 站：{url}', en: 'Posted to Bilibili: {url}' },
  failed: { 'zh-CN': '草稿 {id} 操作失败：{error}', en: 'Draft {id} operation failed: {error}' },
  busy: { 'zh-CN': '草稿 {id} 正在发送，请稍等', en: 'Draft {id} is being sent. Please wait.' },
  disabled: { 'zh-CN': '当前 sendMode 为 off，已禁止出站', en: 'Outbound messages are disabled because sendMode is off.' },
  circuit: { 'zh-CN': 'B 站风控熔断，草稿 {id} 已保留未发。请到网页端确认账号状态，处理后重启插件。', en: 'Bilibili risk controls stopped this endpoint. Draft {id} is retained and was not sent. Check the account on the website, resolve the issue, then restart the plugin.' },
  cookie: { 'zh-CN': 'B 站未登录或登录已失效，无法发送（草稿已保留）。请在 Console「评论审批」页扫码登录，或用 bili-login 扫码。', en: 'Not signed in to Bilibili or the login expired, so the draft was kept unsent. Scan the QR code on the Console "Comment review" page or with bili-login.' },
  limited: { 'zh-CN': '发得太快了，请 {seconds} 秒后再发（草稿 {id} 已保留）', en: 'Sending too quickly. Try again after {seconds} seconds; draft {id} is retained.' },
  invalid: { 'zh-CN': '草稿内容不合法：回复不能为空，且不能超过 {limit} 个字符。', en: 'Invalid draft: replies must be nonempty and at most {limit} characters.' },
  platform: { 'zh-CN': 'B 站返回错误，草稿 {id} 已保留：{error}', en: 'Bilibili returned an error; draft {id} is retained: {error}' },
});

export interface DraftPresentation {
  readonly locale?: Locale;
  /** Bound to the current command index, owner namespace and actual chat prefix. */
  readonly formatCommand?: (localPath: string) => string | undefined;
}

/** 主动提醒的文案（新草稿 / 登录失效 / 登录成功）。 */
export function formatNotice(notice: BilibiliNotice, presentation: DraftPresentation = {}): string {
  const { locale, formatCommand } = presentation;
  switch (notice.kind) {
    case 'draft': {
      const command = formatCommand?.('bili-draft send');
      return [t(locale, 'noticeDraft'), formatDraft(notice.draft, { locale }),
        command === undefined ? t(locale, 'noticeReviewConsole') : t(locale, 'noticeReview', { command: `${command} ${notice.draft.id}` })].join('\n');
    }
    case 'login_expired':
      return t(locale, notice.source === 'config' ? 'noticeExpiredConfig' : 'noticeExpired');
    case 'login_ok':
      return t(locale, 'noticeLoggedIn', { name: notice.uname ? `${notice.uname} (uid ${notice.mid})` : `uid ${notice.mid}` });
  }
}

/** 给 Console 用的草稿链接。 */
export function draftCommentUrl(draft: Pick<BilibiliReplyDraft, 'oid' | 'parent'>): string {
  return commentUrl(draft.oid, draft.parent);
}

function excerpt(text: string, max = 60): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}
function commentUrl(oid: string, rpid: string): string {
  return `https://www.bilibili.com/video/av${oid}#reply${rpid}`;
}
export function formatDraft(draft: BilibiliReplyDraft, options: { readonly full?: boolean; readonly locale?: Locale } = {}): string {
  const { locale } = options;
  const lines = [`[${draft.id}] ${commentUrl(draft.oid, draft.parent)}${draft.status === 'sending' ? t(locale, 'sending') : ''}${draft.interrupted ? t(locale, 'interrupted') : ''}`];
  if (draft.context) lines.push(t(locale, 'original', { author: draft.context.author, text: options.full ? draft.context.text : excerpt(draft.context.text) }));
  lines.push(t(locale, 'reply', { text: options.full ? draft.message : excerpt(draft.message) }));
  return lines.join('\n');
}
export function findDraft(registry: BilibiliEndpointRegistry, id: string): { endpoint: BilibiliEndpoint; draft: BilibiliReplyDraft } | undefined {
  for (const endpoint of registry.values()) {
    const draft = endpoint.drafts.get(id);
    if (draft) return { endpoint, draft };
  }
  return undefined;
}

export function draftEditUsage(presentation: DraftPresentation = {}): string {
  const command = presentation.formatCommand?.('bili-draft edit');
  return command === undefined ? t(presentation.locale, 'editRequired')
    : t(presentation.locale, 'editUsage', { command, content: t(presentation.locale, 'content') });
}
export function listDraftsText(registry: BilibiliEndpointRegistry, presentation: DraftPresentation = {}): string {
  const { locale, formatCommand } = presentation;
  const drafts = [...registry.values()].flatMap(endpoint => endpoint.drafts.list());
  if (drafts.length === 0) return t(locale, 'empty');
  const shown = drafts.slice(-LIST_LIMIT);
  const lines = [t(locale, 'list', { count: drafts.length }), ...shown.map(draft => formatDraft(draft, { locale }))];
  if (drafts.length > shown.length) lines.push(t(locale, 'more', { shown: shown.length, total: drafts.length }));
  const hints: string[] = [];
  for (const [action, key] of [['send', 'sendHint'], ['edit', 'editHint'], ['drop', 'dropHint']] as const) {
    const command = formatCommand?.(`bili-draft ${action}`);
    if (command !== undefined) hints.push(t(locale, key, { command: `${command} <id>${action === 'edit' ? ` ${t(locale, 'content')}` : ''}` }));
  }
  if (hints.length) lines.push('', hints.join('\n'));
  return lines.join('\n');
}
export function showDraftText(registry: BilibiliEndpointRegistry, id: string, presentation: DraftPresentation = {}): string {
  const found = findDraft(registry, id);
  return found ? formatDraft(found.draft, { full: true, locale: presentation.locale }) : t(presentation.locale, 'missing', { id });
}
export function editDraftText(registry: BilibiliEndpointRegistry, id: string, message: string, presentation: DraftPresentation = {}): string {
  const { locale, formatCommand } = presentation;
  const found = findDraft(registry, id);
  if (!found) return t(locale, 'missing', { id });
  try {
    const draft = found.endpoint.editDraft(id, message);
    const command = formatCommand?.('bili-draft send');
    return [t(locale, 'edited'), formatDraft(draft, { full: true, locale }),
      ...(command === undefined ? [] : [t(locale, 'approveHint', { command: `${command} ${id}` })])].join('\n');
  } catch (error) { return reviewErrorText(id, error, locale); }
}
export function discardDraftText(registry: BilibiliEndpointRegistry, id: string, presentation: DraftPresentation = {}): string {
  const found = findDraft(registry, id);
  if (!found) return t(presentation.locale, 'missing', { id });
  try { return t(presentation.locale, found.endpoint.discardDraft(id) ? 'dropped' : 'missing', { id }); }
  catch (error) { return reviewErrorText(id, error, presentation.locale); }
}
export async function approveDraftText(registry: BilibiliEndpointRegistry, id: string, presentation: DraftPresentation = {}): Promise<string> {
  const found = findDraft(registry, id);
  if (!found) return t(presentation.locale, 'missing', { id });
  try {
    const { draft, rpid } = await found.endpoint.approveDraft(id);
    return `${t(presentation.locale, 'sent', { url: commentUrl(draft.oid, rpid) })}\n${excerpt(draft.message, 120)}`;
  } catch (error) { return reviewErrorText(id, error, presentation.locale); }
}
export function reviewErrorText(id: string, error: unknown, locale?: Locale): string {
  if (!(error instanceof BilibiliReviewError)) return t(locale, 'failed', { id, error: error instanceof Error ? error.message : String(error) });
  switch (error.code) {
    case 'not_found': return t(locale, 'missing', { id });
    case 'busy': return t(locale, 'busy', { id });
    case 'send_disabled': return t(locale, 'disabled');
    case 'circuit_open': return t(locale, 'circuit', { id });
    case 'no_cookie': return t(locale, 'cookie');
    case 'rate_limited': return t(locale, 'limited', { id, seconds: Math.ceil((error.retryAfterMs ?? 0) / 1000) });
    case 'invalid_message': return t(locale, 'invalid', { limit: BILIBILI_COMMENT_MAX_LENGTH });
    case 'platform_error': return t(locale, 'platform', { id, error: error.message });
  }
}
