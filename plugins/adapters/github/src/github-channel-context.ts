/**
 * Parse GitHub Issue/PR channel context from IM messages.
 */
import type { Message } from 'zhin.js';
import { buildChannelId, parseChannelId, type ParsedChannel } from './types.js';
import type { GhClient } from './gh-client.js';

export interface GitHubChannelContext extends ParsedChannel {
  channelId: string;
}

export function parseMessageChannel(message: Message): GitHubChannelContext | null {
  const channelId = message.$channel?.id;
  if (!channelId) return null;
  const parsed = parseChannelId(channelId);
  if (!parsed) return null;
  return { ...parsed, channelId };
}

export function issueBranchName(number: number): string {
  return `zhin/bot/issue-${number}`;
}

export async function resolveWorkspaceBranch(
  gh: GhClient,
  ctx: GitHubChannelContext,
): Promise<{ branch: string; base: string }> {
  if (ctx.type === 'pr') {
    const pr = await gh.getPR(ctx.repo, ctx.number);
    if (pr.ok && pr.data?.head?.ref) {
      const base = pr.data.base?.ref ?? 'main';
      return { branch: pr.data.head.ref, base };
    }
    throw new Error(`无法读取 PR #${ctx.number} 的 head 分支`);
  }

  const repoInfo = await gh.getRepo(ctx.repo);
  const base = repoInfo.ok && repoInfo.data?.default_branch
    ? String(repoInfo.data.default_branch)
    : 'main';
  return { branch: issueBranchName(ctx.number), base };
}

export function formatChannelContext(ctx: GitHubChannelContext): string {
  return buildChannelId(ctx.repo, ctx.type, ctx.number);
}
