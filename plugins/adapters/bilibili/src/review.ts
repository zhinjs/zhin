/**
 * 草稿审批（`bili-draft` 命令族）的纯逻辑：列出 / 改写 / 发送 / 丢弃。
 * 命令文件只做参数解析与权限声明（permit role(master)），这里不碰 IM。
 */
import type { BilibiliReplyDraft } from './drafts.js';
import { BilibiliReviewError, type BilibiliEndpoint } from './endpoint.js';
import type { BilibiliEndpointRegistry } from './bilibili-runtime-state.js';

const LIST_LIMIT = 10;

function excerpt(text: string, max = 60): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

function commentUrl(oid: string, rpid: string): string {
  return `https://www.bilibili.com/video/av${oid}#reply${rpid}`;
}

export function formatDraft(draft: BilibiliReplyDraft, options: { readonly full?: boolean } = {}): string {
  const lines = [`[${draft.id}] ${commentUrl(draft.oid, draft.parent)}${draft.status === 'sending' ? '（发送中）' : ''}`];
  if (draft.context) lines.push(`  原评论 ${draft.context.author}：${options.full ? draft.context.text : excerpt(draft.context.text)}`);
  lines.push(`  拟回复：${options.full ? draft.message : excerpt(draft.message)}`);
  return lines.join('\n');
}

function findDraft(registry: BilibiliEndpointRegistry, id: string): { endpoint: BilibiliEndpoint; draft: BilibiliReplyDraft } | undefined {
  for (const endpoint of registry.values()) {
    const draft = endpoint.drafts.get(id);
    if (draft) return { endpoint, draft };
  }
  return undefined;
}

export function listDraftsText(registry: BilibiliEndpointRegistry): string {
  const drafts = [...registry.values()].flatMap((endpoint) => endpoint.drafts.list());
  if (drafts.length === 0) return '没有待审的 B 站评论草稿';
  const shown = drafts.slice(-LIST_LIMIT);
  const lines = shown.map((draft) => formatDraft(draft));
  const more = drafts.length > shown.length ? `\n（只显示最新 ${shown.length} 条，共 ${drafts.length} 条）` : '';
  return `待审草稿 ${drafts.length} 条：\n${lines.join('\n')}${more}\n\n发送：bili-draft send <id>；改写：bili-draft edit <id> <新内容>；丢弃：bili-draft drop <id>`;
}

export function showDraftText(registry: BilibiliEndpointRegistry, id: string): string {
  const found = findDraft(registry, id);
  return found ? formatDraft(found.draft, { full: true }) : `找不到草稿 ${id}`;
}

export function editDraftText(registry: BilibiliEndpointRegistry, id: string, message: string): string {
  const found = findDraft(registry, id);
  if (!found) return `找不到草稿 ${id}`;
  try {
    const draft = found.endpoint.editDraft(id, message);
    return `已改写，还没发出：\n${formatDraft(draft, { full: true })}\n确认无误后：bili-draft send ${id}`;
  } catch (error) {
    return reviewErrorText(id, error);
  }
}

export function discardDraftText(registry: BilibiliEndpointRegistry, id: string): string {
  const found = findDraft(registry, id);
  if (!found) return `找不到草稿 ${id}`;
  try {
    return found.endpoint.discardDraft(id) ? `已丢弃草稿 ${id}（未发送）` : `找不到草稿 ${id}`;
  } catch (error) {
    return reviewErrorText(id, error);
  }
}

export async function approveDraftText(registry: BilibiliEndpointRegistry, id: string): Promise<string> {
  const found = findDraft(registry, id);
  if (!found) return `找不到草稿 ${id}`;
  try {
    const { draft, rpid } = await found.endpoint.approveDraft(id);
    return `已发到 B 站：${commentUrl(draft.oid, rpid)}\n${excerpt(draft.message, 120)}`;
  } catch (error) {
    return reviewErrorText(id, error);
  }
}

function reviewErrorText(id: string, error: unknown): string {
  if (!(error instanceof BilibiliReviewError)) {
    return `草稿 ${id} 操作失败：${error instanceof Error ? error.message : String(error)}`;
  }
  switch (error.code) {
    case 'not_found': return `找不到草稿 ${id}`;
    case 'busy': return `草稿 ${id} 正在发送，请稍等`;
    case 'send_disabled': return '当前 sendMode 为 off，已禁止出站';
    case 'circuit_open': return `B 站风控熔断，草稿 ${id} 已保留未发。请到网页端确认账号状态，处理后重启插件。`;
    case 'no_cookie': return '没有配置 SESSDATA + bili_jct，无法发送';
    case 'rate_limited': return `发得太快了，请 ${Math.ceil((error.retryAfterMs ?? 0) / 1000)} 秒后再发（草稿 ${id} 已保留）`;
    case 'invalid_message': return `草稿内容不合法：${error.message}`;
    case 'platform_error': return `B 站返回错误，草稿 ${id} 已保留：${error.message}`;
  }
}
