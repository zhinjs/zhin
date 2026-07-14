/**
 * GitHub App Bot workflow handlers (Installation Token identity).
 */
import type { Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import { getAdapter, getGithubAgentDeps } from './github-agent-deps.js';
import {
  parseMessageChannel,
  resolveWorkspaceBranch,
  formatChannelContext,
} from './github-channel-context.js';

function requireBotGh() {
  const gh = getAdapter().getAPI();
  if (!gh?.isAppAuth) {
    throw new Error('需要 GitHub App 认证（app_id + private_key），Bot 写操作不可用');
  }
  return gh;
}

function resolveCommMessage(commMessage?: Message): Message {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg) throw new Error('无 IM 上下文，请在 Issue/PR 评论线程内调用');
  return msg;
}

function resolveChannel(msg: Message, repo?: string) {
  const ctx = parseMessageChannel(msg);
  if (ctx) return ctx;
  if (repo) {
    throw new Error(`请从 GitHub Issue/PR 频道调用，或提供完整 channel（当前仅 repo=${repo}）`);
  }
  throw new Error('无法解析 GitHub 频道（需要 Issue/PR 评论上下文）');
}

export async function executeGithubPrepareWorkspace(
  args: { repo?: string },
  commMessage?: Message,
) {
  const msg = resolveCommMessage(commMessage);
  const ctx = resolveChannel(msg, args.repo);
  const gh = requireBotGh();
  const wm = getGithubAgentDeps().getWorkspaceManager();
  const { branch, base } = await resolveWorkspaceBranch(gh, ctx);
  const repoPath = await wm.checkoutBranch(ctx.repo, branch, base);
  return [
    `✅ 工作区就绪`,
    `📁 ${repoPath}`,
    `🌿 分支 \`${branch}\`（base: \`${base}\`）`,
    `📍 ${formatChannelContext(ctx)}`,
  ].join('\n');
}

export async function executeGithubPatchFile(
  args: { repo?: string; path: string; content: string; message: string; branch?: string },
  commMessage?: Message,
) {
  const msg = resolveCommMessage(commMessage);
  const ctx = resolveChannel(msg, args.repo);
  const gh = requireBotGh();
  const { branch } = args.branch
    ? { branch: args.branch }
    : await resolveWorkspaceBranch(gh, ctx);

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
    return `❌ 更新文件失败: ${JSON.stringify(r.data)}`;
  }
  const url = r.data.content?.html_url ?? r.data.commit?.html_url ?? '';
  return `✅ 已更新 \`${args.path}\` @ \`${branch}\`${url ? `\n🔗 ${url}` : ''}`;
}

export async function executeGithubPushBranch(
  args: { repo?: string; branch?: string; message: string },
  commMessage?: Message,
) {
  const msg = resolveCommMessage(commMessage);
  const ctx = resolveChannel(msg, args.repo);
  const gh = requireBotGh();
  const wm = getGithubAgentDeps().getWorkspaceManager();
  const branch = args.branch ?? (await resolveWorkspaceBranch(gh, ctx)).branch;
  const result = await wm.commitAndPush(ctx.repo, branch, args.message);
  return `✅ ${result}\n📍 ${ctx.repo} @ \`${branch}\``;
}

export async function executeGithubCreatePr(
  args: { repo?: string; title: string; body?: string; head?: string; base?: string },
  commMessage?: Message,
) {
  const msg = resolveCommMessage(commMessage);
  const ctx = resolveChannel(msg, args.repo);
  const gh = requireBotGh();
  const resolved = await resolveWorkspaceBranch(gh, ctx);
  const head = args.head ?? resolved.branch;
  const base = args.base ?? resolved.base;
  const r = await gh.createPullRequest(ctx.repo, args.title, head, base, args.body);
  if (!r.ok) {
    return `❌ 创建 PR 失败: ${JSON.stringify(r.data)}`;
  }
  return `✅ PR #${r.data.number} 已创建\n🔗 ${r.data.html_url}`;
}
