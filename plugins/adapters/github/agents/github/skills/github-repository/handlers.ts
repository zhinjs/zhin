import { createMessages, resolveLocale, type Locale } from 'zhin.js/i18n';
/**
 * GitHub App Bot workflow handlers (Installation Token identity).
 */
import type { Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import {
  formatChannelContext,
  parseMessageChannel,
  resolveWorkspaceBranch,
} from '../../../../src/github-channel-context.js';
import type { GithubEndpoint } from '../../../../src/endpoint.js';

function requireBotGh(client: GithubEndpoint, locale?: Locale) {
  const gh = client;
  if (!gh?.isAppAuth) {
    throw new Error(t(locale, 'appRequired'));
  }
  return gh;
}

function resolveCommMessage(commMessage?: Message, locale?: Locale): Message {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg) throw new Error(t(locale, 'contextRequired'));
  return msg;
}

function resolveChannel(msg: Message, repo?: string, locale?: Locale) {
  const ctx = parseMessageChannel(msg);
  if (ctx) return ctx;
  if (repo) {
    throw new Error(t(locale, 'channelRequiredForRepo', { repo }));
  }
  throw new Error(t(locale, 'channelRequired'));
}

export async function executeGithubPrepareWorkspace(
  args: { repo?: string },
  client: GithubEndpoint,
  commMessage?: Message,
  preference?: Locale,
) {
  const msg = resolveCommMessage(commMessage, preference);
  const locale = resolveLocale(preference ?? msg.locale);
  const ctx = resolveChannel(msg, args.repo, locale);
  const gh = requireBotGh(client, locale);
  const wm = client.workspaceManager;
  const { branch, base } = await resolveWorkspaceBranch(gh, ctx, locale);
  const repoPath = await wm.checkoutBranch(ctx.repo, branch, base, locale);
  return [
    t(locale, 'workspaceReady'),
    `📁 ${repoPath}`,
    t(locale, 'branch', { branch, base }),
    `📍 ${formatChannelContext(ctx)}`,
  ].join('\n');
}

export async function executeGithubPatchFile(
  args: { repo?: string; path: string; content: string; message: string; branch?: string },
  client: GithubEndpoint,
  commMessage?: Message,
  preference?: Locale,
) {
  const msg = resolveCommMessage(commMessage, preference);
  const locale = resolveLocale(preference ?? msg.locale);
  const ctx = resolveChannel(msg, args.repo, locale);
  const gh = requireBotGh(client, locale);
  const { branch } = args.branch
    ? { branch: args.branch }
    : await resolveWorkspaceBranch(gh, ctx, locale);

  const existing = await gh.getFileContent(ctx.repo, args.path, branch);
  const sha = existing.ok ? existing.data.sha : undefined;
  const r = await gh.createOrUpdateFile(
    ctx.repo,
    args.path,
    args.content,
    args.message,
    { branch, sha },
  );
  if (!r.ok) {
    return t(locale, 'fileFailed', { error: JSON.stringify(r.data) });
  }
  const url = r.data.content?.html_url ?? r.data.commit?.html_url ?? '';
  return t(locale, 'fileUpdated', { path: args.path, branch }) + (url ? `\n🔗 ${url}` : '');
}

export async function executeGithubPushBranch(
  args: { repo?: string; branch?: string; message: string },
  client: GithubEndpoint,
  commMessage?: Message,
  preference?: Locale,
) {
  const msg = resolveCommMessage(commMessage, preference);
  const locale = resolveLocale(preference ?? msg.locale);
  const ctx = resolveChannel(msg, args.repo, locale);
  const gh = requireBotGh(client, locale);
  const wm = client.workspaceManager;
  const branch = args.branch ?? (await resolveWorkspaceBranch(gh, ctx, locale)).branch;
  const result = await wm.commitAndPush(ctx.repo, branch, args.message, locale);
  return `✅ ${result}\n📍 ${ctx.repo} @ \`${branch}\``;
}

export async function executeGithubCreatePr(
  args: { repo?: string; title: string; body?: string; head?: string; base?: string },
  client: GithubEndpoint,
  commMessage?: Message,
  preference?: Locale,
) {
  const msg = resolveCommMessage(commMessage, preference);
  const locale = resolveLocale(preference ?? msg.locale);
  const ctx = resolveChannel(msg, args.repo, locale);
  const gh = requireBotGh(client, locale);
  const resolved = await resolveWorkspaceBranch(gh, ctx, locale);
  const head = args.head ?? resolved.branch;
  const base = args.base ?? resolved.base;
  const r = await gh.createPullRequest(ctx.repo, args.title, head, base, args.body);
  if (!r.ok) {
    return t(locale, 'prFailed', { error: JSON.stringify(r.data) });
  }
  return t(locale, 'prCreated', { number: r.data.number, url: r.data.html_url });
}

const t = createMessages({
  "appRequired": {
    "zh-CN": "需要 GitHub App 认证（app_id + private_key），Bot 写操作不可用",
    "en": "GitHub App authentication (app_id + private_key) is required for bot writes"
  },
  "contextRequired": {
    "zh-CN": "无 IM 上下文，请在 Issue/PR 评论线程内调用",
    "en": "No IM context. Use this tool from an Issue/PR comment thread"
  },
  "channelRequiredForRepo": {
    "zh-CN": "请从 GitHub Issue/PR 频道调用，或提供完整 channel（当前仅 repo={repo}）",
    "en": "Use a GitHub Issue/PR channel or provide a full channel (only repo={repo} is available)"
  },
  "channelRequired": {
    "zh-CN": "无法解析 GitHub 频道（需要 Issue/PR 评论上下文）",
    "en": "Cannot resolve the GitHub channel (Issue/PR comment context is required)"
  },
  "workspaceReady": {
    "zh-CN": "✅ 工作区就绪",
    "en": "✅ Workspace ready"
  },
  "branch": {
    "zh-CN": "🌿 分支 `{branch}`（base: `{base}`）",
    "en": "🌿 Branch `{branch}` (base: `{base}`)"
  },
  "fileFailed": {
    "zh-CN": "❌ 更新文件失败: {error}",
    "en": "❌ Failed to update the file: {error}"
  },
  "fileUpdated": {
    "zh-CN": "✅ 已更新 `{path}` @ `{branch}`",
    "en": "✅ Updated `{path}` @ `{branch}`"
  },
  "prFailed": {
    "zh-CN": "❌ 创建 PR 失败: {error}",
    "en": "❌ Failed to create the PR: {error}"
  },
  "prCreated": {
    "zh-CN": "✅ PR #{number} 已创建\n🔗 {url}",
    "en": "✅ PR #{number} created\n🔗 {url}"
  }
});
