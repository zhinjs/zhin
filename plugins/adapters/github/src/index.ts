/**
 * GitHub 适配器入口：类型扩展、模型、导出、注册
 */
import { usePlugin, type Plugin, type Context, type ToolFeature, type Tool, type ToolContext } from 'zhin.js';
import { GitHubAdapter } from './adapter.js';
import { GhClient } from './gh-client.js';
import type { EventType } from './types.js';

declare module 'zhin.js' {
  interface Adapters {
    github: GitHubAdapter;
  }
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: import('./types.js').EventType[];
      target_id: string;
      target_type: 'private' | 'group' | 'channel';
      adapter: string;
      bot: string;
    };
    github_events: {
      id: number;
      repo: string;
      event_type: string;
      payload: any;
    };
    github_oauth_users: import('./types.js').GitHubOAuthUser;
  }
}

export * from './types.js';
export { GitHubBot, parseMarkdown, toMarkdown } from './bot.js';
export { GitHubAdapter } from './adapter.js';
export { GhClient } from './gh-client.js';

const plugin = usePlugin();
const { provide, defineModel, useContext, logger } = plugin;

defineModel('github_subscriptions', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  events: { type: 'json', default: [] },
  target_id: { type: 'text', nullable: false },
  target_type: { type: 'text', nullable: false },
  adapter: { type: 'text', nullable: false },
  bot: { type: 'text', nullable: false },
});

defineModel('github_events', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  event_type: { type: 'text', nullable: false },
  payload: { type: 'json', default: {} },
});

defineModel('github_oauth_users', {
  id: { type: 'integer', primary: true },
  platform: { type: 'text', nullable: false },
  platform_uid: { type: 'text', nullable: false },
  github_login: { type: 'text', nullable: false },
  access_token: { type: 'text', nullable: false },
  created_at: { type: 'integer', default: 0 },
});

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via gh CLI',
  mounted: async (p: Plugin) => {
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: GitHubAdapter) => {
    await adapter.stop();
  },
} as Context<'github'>);

// 混合模式：有 router + webhook_secret → Webhook 实时；否则 → 轮询降级
useContext('github', (adapter) => {
  if (adapter.hasWebhookConfig) {
    // 尝试注册 Webhook（需要 router Context）
    const router = plugin.inject('router');
    if (router) {
      adapter.setupWebhook(router);
      logger.info('GitHub 事件源: Webhook (实时)');
    } else {
      // router 还没就绪，等它挂载后再注册
      plugin.useContext('router', (r) => {
        adapter.setupWebhook(r);
        logger.info('GitHub 事件源: Webhook (实时, 延迟注册)');
      });
    }
  }
  // Webhook 未配置或未激活时，总是启动轮询作为兜底
  if (!adapter.webhookActive) {
    adapter.startPolling();
    logger.info('GitHub 事件源: 轮询');
  }
  return () => adapter.stopPolling();
});

// ── Tool 工具注册 ─────────────────────────────────────────────────────────
useContext('tool', 'github', (toolService: ToolFeature, adapter: GitHubAdapter) => {
  const tools: Tool[] = [
    // --- PR ---
    {
      name: 'github_pr',
      description: 'GitHub PR 操作：list/view/diff/merge/create/review/close',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'list|view|diff|merge|create|review|close', enum: ['list','view','diff','merge','create','review','close'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          number: { type: 'number' as const, description: 'PR 编号' },
          title: { type: 'string' as const, description: 'PR 标题 (create)' },
          body: { type: 'string' as const, description: 'PR 描述 / Review 评语' },
          head: { type: 'string' as const, description: '源分支 (create)' },
          base: { type: 'string' as const, description: '目标分支 (create，默认 main)' },
          state: { type: 'string' as const, description: 'open/closed/all (list)' },
          approve: { type: 'boolean' as const, description: 'review 时 approve' },
          method: { type: 'string' as const, description: 'squash/merge/rebase (merge)' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, number: num, title, body, head, base, state, approve, method } = args;
        switch (action) {
          case 'list': {
            const r = await api.listPRs(repo, state || 'open');
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.length) return `📭 没有 ${state || 'open'} 状态的 PR`;
            return r.data.map((p: any) =>
              `#${p.number} ${p.draft ? '[Draft] ' : ''}${p.title}\n   👤 ${p.user.login} | 🌿 ${p.head.ref} → ${p.base.ref} | ${p.state}`
            ).join('\n\n');
          }
          case 'view': {
            if (!num) return '❌ 请提供 PR 编号';
            const r = await api.getPR(repo, num);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            const p = r.data;
            return [
              `#${p.number} ${p.title}`,
              `👤 ${p.user.login} | ${p.state} | 🌿 ${p.head.ref} → ${p.base.ref}`,
              `📅 ${p.created_at?.split('T')[0]} | +${p.additions} -${p.deletions} (${p.changed_files} files)`,
              p.body ? `\n${p.body.slice(0, 500)}${p.body.length > 500 ? '...' : ''}` : '',
              `\n🔗 ${p.html_url}`,
            ].filter(Boolean).join('\n');
          }
          case 'diff': {
            if (!num) return '❌ 请提供 PR 编号';
            const r = await api.getPRDiff(repo, num);
            if (!r.ok) return '❌ 获取 diff 失败';
            const lines = r.data.split('\n');
            return lines.length > 100 ? lines.slice(0, 100).join('\n') + `\n\n... (共 ${lines.length} 行)` : r.data;
          }
          case 'merge': {
            if (!num) return '❌ 请提供 PR 编号';
            const r = await api.mergePR(repo, num, method || 'squash');
            return r.ok ? `✅ PR #${num} 已合并` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'create': {
            if (!title) return '❌ 请提供 PR 标题';
            if (!head) return '❌ 请提供源分支 (head)';
            const r = await api.createPR(repo, title, body || '', head, base || 'main');
            return r.ok ? `✅ PR 已创建: ${r.data.html_url}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'review': {
            if (!num) return '❌ 请提供 PR 编号';
            const event = approve ? 'APPROVE' : 'COMMENT';
            const r = await api.createPRReview(repo, num, event as any, body || undefined);
            return r.ok ? `✅ PR #${num} ${approve ? '已批准' : '已评论'}` : `❌ ${r.data?.message}`;
          }
          case 'close': {
            if (!num) return '❌ 请提供 PR 编号';
            const r = await api.closePR(repo, num);
            return r.ok ? `✅ PR #${num} 已关闭` : `❌ ${r.data?.message}`;
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Issue ---
    {
      name: 'github_issue',
      description: 'GitHub Issue 操作：list/view/create/close/comment',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'list|view|create|close|comment', enum: ['list','view','create','close','comment'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          number: { type: 'number' as const, description: 'Issue 编号' },
          title: { type: 'string' as const, description: 'Issue 标题 (create)' },
          body: { type: 'string' as const, description: 'Issue 内容 / 评论内容' },
          labels: { type: 'string' as const, description: '标签，逗号分隔 (create)' },
          state: { type: 'string' as const, description: 'open/closed/all (list)' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, number: num, title, body, labels, state } = args;
        switch (action) {
          case 'list': {
            const r = await api.listIssues(repo, state || 'open');
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            const issues = r.data.filter((i: any) => !i.pull_request);
            if (!issues.length) return `📭 没有 ${state || 'open'} 状态的 Issue`;
            return issues.map((i: any) => {
              const lbls = i.labels?.map((l: any) => l.name).join(', ') || '';
              return `#${i.number} ${i.title}\n   👤 ${i.user.login}${lbls ? ` | 🏷️ ${lbls}` : ''} | ${i.state}`;
            }).join('\n\n');
          }
          case 'view': {
            if (!num) return '❌ 请提供 Issue 编号';
            const r = await api.getIssue(repo, num);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            const i = r.data;
            return [
              `#${i.number} ${i.title}`,
              `👤 ${i.user.login} | ${i.state} | 📅 ${i.created_at?.split('T')[0]}`,
              i.labels?.length ? `🏷️ ${i.labels.map((l: any) => l.name).join(', ')}` : null,
              i.body ? `\n${i.body.slice(0, 500)}${i.body.length > 500 ? '...' : ''}` : '',
              `\n🔗 ${i.html_url}`,
            ].filter(Boolean).join('\n');
          }
          case 'create': {
            if (!title) return '❌ 请提供 Issue 标题';
            const labelArr = labels ? labels.split(',').map((s: string) => s.trim()) : undefined;
            const r = await api.createIssue(repo, title, body || undefined, labelArr);
            return r.ok ? `✅ Issue 已创建: ${r.data.html_url}` : `❌ ${r.data?.message}`;
          }
          case 'close': {
            if (!num) return '❌ 请提供 Issue 编号';
            const r = await api.closeIssue(repo, num);
            return r.ok ? `✅ Issue #${num} 已关闭` : `❌ ${r.data?.message}`;
          }
          case 'comment': {
            if (!num) return '❌ 请提供 Issue 编号';
            if (!body) return '❌ 请提供评论内容';
            const r = await api.createIssueComment(repo, num, body);
            return r.ok ? `✅ 已评论 Issue #${num}` : `❌ ${JSON.stringify(r.data)}`;
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Repo ---
    {
      name: 'github_repo',
      description: 'GitHub 仓库查询：info/branches/releases/runs(CI)/stars',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'info|branches|releases|runs|stars', enum: ['info','branches','releases','runs','stars'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          limit: { type: 'number' as const, description: '返回数量，默认 10' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, limit: lim } = args;
        const limit = lim || 10;
        switch (action) {
          case 'info': {
            const r = await api.getRepo(repo);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            const d = r.data;
            return [
              `📦 ${d.full_name}${d.private ? ' 🔒' : ''}`,
              d.description ? `📝 ${d.description}` : null,
              `⭐ ${d.stargazers_count} | 🍴 ${d.forks_count} | 👀 ${d.watchers_count}`,
              `🌿 默认分支: ${d.default_branch}`,
              d.license ? `📄 ${d.license.name}` : null,
              d.homepage ? `🌐 ${d.homepage}` : null,
              `📅 创建: ${d.created_at?.split('T')[0]} | 推送: ${d.pushed_at?.split('T')[0]}`,
            ].filter(Boolean).join('\n');
          }
          case 'branches': {
            const r = await api.listBranches(repo, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            return r.data.length
              ? `🌿 分支 (${r.data.length}):\n${r.data.map((b: any) => `  • ${b.name}${b.protected ? ' 🔒' : ''}`).join('\n')}`
              : '没有找到分支';
          }
          case 'releases': {
            const r = await api.listReleases(repo, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.length) return '📭 暂无发布';
            return r.data.map((rel: any) =>
              `${rel.prerelease ? '🧪' : '📦'} ${rel.tag_name} — ${rel.name || '(no title)'}\n   📅 ${rel.published_at?.split('T')[0]} | 👤 ${rel.author?.login}`
            ).join('\n\n');
          }
          case 'runs': {
            const r = await api.listWorkflowRuns(repo, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            const runs = r.data.workflow_runs || [];
            if (!runs.length) return '📭 暂无 CI 记录';
            return runs.map((run: any) => {
              const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.status === 'in_progress' ? '🔄' : '⏳';
              return `${icon} #${run.id} ${run.display_title}\n   🌿 ${run.head_branch} | ${run.status}${run.conclusion ? '/' + run.conclusion : ''}`;
            }).join('\n\n');
          }
          case 'stars': {
            const r = await api.getRepo(repo);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            return `⭐ ${r.data.stargazers_count} stars | 🍴 ${r.data.forks_count} forks`;
          }
          default: return `❌ 未知查询: ${action}`;
        }
      },
    },
    // --- Search ---
    {
      name: 'github_search',
      description: 'GitHub 搜索：在 issues/repos/code 中搜索',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'issues|repos|code', enum: ['issues', 'repos', 'code'] },
          query: { type: 'string' as const, description: '搜索关键词' },
          limit: { type: 'number' as const, description: '返回数量，默认 10' },
        },
        required: ['action', 'query'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, query: q, limit: lim } = args;
        const limit = lim || 10;
        switch (action) {
          case 'issues': {
            const r = await api.searchIssues(q, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.items.length) return '📭 没有匹配的 Issue/PR';
            return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
              r.data.items.map((i: any) =>
                `${i.pull_request ? '🔀' : '🐛'} ${i.repository_url.replace('https://api.github.com/repos/', '')}#${i.number}\n   ${i.title}\n   👤 ${i.user.login} | ${i.state}`
              ).join('\n\n');
          }
          case 'repos': {
            const r = await api.searchRepos(q, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.items.length) return '📭 没有匹配的仓库';
            return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
              r.data.items.map((repo: any) =>
                `📦 ${repo.full_name}${repo.private ? ' 🔒' : ''}\n   ${repo.description || '(无描述)'}\n   ⭐ ${repo.stargazers_count} | 🍴 ${repo.forks_count} | 📝 ${repo.language || '?'}`
              ).join('\n\n');
          }
          case 'code': {
            const r = await api.searchCode(q, limit);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.items.length) return '📭 没有匹配的代码';
            return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
              r.data.items.map((c: any) =>
                `📄 ${c.repository.full_name}/${c.path}\n   🔗 ${c.html_url}`
              ).join('\n\n');
          }
          default: return `❌ 未知搜索类型: ${action}`;
        }
      },
    },
    // --- Label ---
    {
      name: 'github_label',
      description: 'GitHub 标签管理：查看/添加/移除 Issue/PR 标签',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'list|add|remove', enum: ['list', 'add', 'remove'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          number: { type: 'number' as const, description: 'Issue/PR 编号 (add/remove 必填)' },
          labels: { type: 'string' as const, description: '标签名，逗号分隔 (add/remove)' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, number: num, labels } = args;
        switch (action) {
          case 'list': {
            const r = await api.listLabels(repo);
            if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
            if (!r.data.length) return '📭 仓库没有标签';
            return `🏷️ ${repo} 标签 (${r.data.length}):\n` +
              r.data.map((l: any) => `  • ${l.name}${l.description ? ` — ${l.description}` : ''}`).join('\n');
          }
          case 'add': {
            if (!num) return '❌ 请提供 Issue/PR 编号';
            if (!labels) return '❌ 请提供标签名';
            const labelArr = labels.split(',').map((s: string) => s.trim());
            const r = await api.addLabels(repo, num, labelArr);
            return r.ok ? `✅ 已添加标签: ${labelArr.join(', ')}` : `❌ ${JSON.stringify(r.data)}`;
          }
          case 'remove': {
            if (!num) return '❌ 请提供 Issue/PR 编号';
            if (!labels) return '❌ 请提供要移除的标签名';
            const labelArr = labels.split(',').map((s: string) => s.trim());
            const results: string[] = [];
            for (const label of labelArr) {
              const r = await api.removeLabel(repo, num, label);
              results.push(r.ok ? `✅ ${label}` : `❌ ${label}: ${r.data?.message || 'failed'}`);
            }
            return results.join('\n');
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Assign ---
    {
      name: 'github_assign',
      description: 'GitHub 指派管理：给 Issue/PR 添加/移除指派人',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'add|remove', enum: ['add', 'remove'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          number: { type: 'number' as const, description: 'Issue/PR 编号 (必填)' },
          assignees: { type: 'string' as const, description: '用户名，逗号分隔 (必填)' },
        },
        required: ['action', 'repo', 'number', 'assignees'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, number: num, assignees } = args;
        const assigneeArr = assignees.split(',').map((s: string) => s.trim());
        if (action === 'add') {
          const r = await api.addAssignees(repo, num, assigneeArr);
          return r.ok ? `✅ 已指派: ${assigneeArr.join(', ')}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        } else {
          const r = await api.removeAssignees(repo, num, assigneeArr);
          return r.ok ? `✅ 已移除指派: ${assigneeArr.join(', ')}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        }
      },
    },
    // --- File ---
    {
      name: 'github_file',
      description: '读取 GitHub 仓库中的文件内容',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          path: { type: 'string' as const, description: '文件路径 (必填)' },
          ref: { type: 'string' as const, description: '分支/tag/commit SHA (可选，默认主分支)' },
        },
        required: ['repo', 'path'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const r = await api.getFileContent(args.repo, args.path, args.ref);
        if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        if (Array.isArray(r.data)) {
          return `📂 ${args.path} (目录，${r.data.length} 项):\n` +
            r.data.map((f: any) => `  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n');
        }
        if (r.data.type === 'file' && r.data.content) {
          const decoded = Buffer.from(r.data.content, 'base64').toString('utf-8');
          const maxLen = 3000;
          const truncated = decoded.length > maxLen;
          return `📄 ${r.data.path} (${r.data.size} bytes)\n\n${decoded.slice(0, maxLen)}${truncated ? `\n\n... (截断，共 ${decoded.length} 字符)` : ''}`;
        }
        return `📄 ${r.data.path} — ${r.data.type} (${r.data.size} bytes)\n🔗 ${r.data.html_url}`;
      },
    },
    // --- Commits ---
    {
      name: 'github_commits',
      description: 'GitHub 提交查询：列出提交记录或对比两个分支',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'list|compare', enum: ['list', 'compare'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          sha: { type: 'string' as const, description: '分支/SHA (list)' },
          path: { type: 'string' as const, description: '按文件路径过滤 (list)' },
          base: { type: 'string' as const, description: '基准分支 (compare)' },
          head: { type: 'string' as const, description: '目标分支 (compare)' },
          limit: { type: 'number' as const, description: '返回数量，默认 10' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { action, repo, sha, path, base, head, limit: lim } = args;
        if (action === 'list') {
          const r = await api.listCommits(repo, sha, path, lim || 10);
          if (!r.ok) return `❌ ${JSON.stringify(r.data)}`;
          if (!r.data.length) return '📭 没有找到提交记录';
          return r.data.map((c: any) =>
            `• ${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}\n  👤 ${c.commit.author?.name || '?'} | 📅 ${c.commit.author?.date?.split('T')[0] || '?'}`
          ).join('\n\n');
        } else {
          if (!base || !head) return '❌ compare 需要 base 和 head 参数';
          const r = await api.compareCommits(repo, base, head);
          if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          const d = r.data;
          return [
            `🔀 ${base} ← ${head}`,
            `📊 ${d.status} | ${d.ahead_by} ahead, ${d.behind_by} behind`,
            `📝 ${d.total_commits} commits | ${d.files?.length || 0} files changed`,
            d.commits?.length ? '\n最近提交:\n' + d.commits.slice(0, 5).map((c: any) =>
              `  • ${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}`
            ).join('\n') : '',
          ].filter(Boolean).join('\n');
        }
      },
    },
    // --- Edit (Issue/PR) ---
    {
      name: 'github_edit',
      description: '编辑 GitHub Issue 或 PR 的标题、正文、状态',
      parameters: {
        type: 'object' as const,
        properties: {
          type: { type: 'string' as const, description: 'issue|pr', enum: ['issue', 'pr'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          number: { type: 'number' as const, description: 'Issue/PR 编号 (必填)' },
          title: { type: 'string' as const, description: '新标题' },
          body: { type: 'string' as const, description: '新正文' },
          state: { type: 'string' as const, description: 'open|closed' },
        },
        required: ['type', 'repo', 'number'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const api = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!api) return '❌ 没有可用的 GitHub bot';
        const { type: itemType, repo, number: num, title, body, state } = args;
        const data: any = {};
        if (title) data.title = title;
        if (body) data.body = body;
        if (state) data.state = state;
        if (!Object.keys(data).length) return '❌ 请至少提供一个要修改的字段 (title/body/state)';
        const r = itemType === 'pr'
          ? await api.updatePR(repo, num, data)
          : await api.updateIssue(repo, num, data);
        if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        return `✅ ${itemType === 'pr' ? 'PR' : 'Issue'} #${num} 已更新\n🔗 ${r.data.html_url}`;
      },
    },
    // --- Star ---
    {
      name: 'github_star',
      description: 'Star 或取消 Star 一个 GitHub 仓库（使用你绑定的 GitHub 账号，未绑定则用 Bot 默认账号）',
      parameters: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, description: 'star|unstar|check', enum: ['star', 'unstar', 'check'] },
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['action', 'repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const gh = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!gh) return '❌ 没有可用的 GitHub bot';
        const { action, repo } = args;
        switch (action) {
          case 'star': {
            const r = await gh.starRepo(repo);
            return r.ok ? `⭐ 已 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'unstar': {
            const r = await gh.unstarRepo(repo);
            return r.ok ? `💔 已取消 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'check': {
            const starred = await gh.isStarred(repo);
            return starred ? `⭐ 已 Star ${repo}` : `☆ 尚未 Star ${repo}`;
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Fork ---
    {
      name: 'github_fork',
      description: 'Fork 一个 GitHub 仓库（使用你绑定的 GitHub 账号，未绑定则用 Bot 默认账号）',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        const gh = await adapter.getUserOrDefaultAPI(context?.platform, context?.senderId);
        if (!gh) return '❌ 没有可用的 GitHub bot';
        const r = await gh.forkRepo(args.repo);
        if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        return `🍴 已 Fork ${args.repo} → ${r.data.full_name}\n🔗 ${r.data.html_url}`;
      },
    },
    // --- Bind (Device Flow) ---
    {
      name: 'github_bind',
      description: '绑定你的 GitHub 账号 — 使用 Device Flow 授权，无需输入密码',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const clientId = adapter.getClientId();
        if (!clientId) return '❌ Bot 未配置 GitHub App 或 App 无 client_id，无法进行账号绑定';

        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        // 检查是否已绑定
        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (existing) {
          return `⚠️ 你已绑定 GitHub 账号: ${existing.github_login}\n如需重新绑定，请先执行 github_unbind`;
        }

        try {
          const host = adapter.getHost();
          const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
          // 异步轮询 token（最多等 codeResp.expires_in 秒）
          const tokenPromise = GhClient.deviceFlowPollToken(
            clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
          );

          // 先回复用户授权链接
          const replyMsg = [
            `🔗 请在浏览器中打开以下链接进行授权：`,
            `   ${codeResp.verification_uri}`,
            ``,
            `📋 输入验证码: **${codeResp.user_code}**`,
            ``,
            `⏳ 等待授权中…（${Math.floor(codeResp.expires_in / 60)} 分钟内有效）`,
          ].join('\n');

          // 在后台等待用户授权完成
          tokenPromise.then(async (tokenData) => {
            if (!tokenData) {
              // 授权超时或被拒绝 — 由于 execute 已经返回了，这里只能通过日志记录
              logger.warn(`GitHub Device Flow 超时/拒绝: ${context.platform}:${context.senderId}`);
              return;
            }

            // 使用 token 获取 GitHub 用户名
            const userGh = new GhClient({ host, token: tokenData.access_token });
            const authResult = await userGh.verifyAuth();
            const login = authResult.ok ? authResult.user : 'unknown';

            await model.insert({
              id: Date.now(),
              platform: context.platform,
              platform_uid: context.senderId,
              github_login: login,
              access_token: tokenData.access_token,
              created_at: Date.now(),
            });
            logger.info(`GitHub 账号绑定成功: ${context.platform}:${context.senderId} → ${login}`);

            // 尝试回复绑定成功消息
            if (context.message?.$reply) {
              await context.message.$reply(`✅ GitHub 账号绑定成功！\n👤 ${login}`);
            }
          }).catch(err => {
            logger.error('GitHub Device Flow 错误:', err);
          });

          return replyMsg;
        } catch (e: any) {
          return `❌ Device Flow 启动失败: ${e.message}`;
        }
      },
    },
    // --- Unbind ---
    {
      name: 'github_unbind',
      description: '解除你绑定的 GitHub 账号',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!existing) return '📭 你尚未绑定 GitHub 账号';

        await model.delete().where({ id: existing.id });
        return `✅ 已解除 GitHub 账号绑定: ${existing.github_login}`;
      },
    },
    // --- Whoami ---
    {
      name: 'github_whoami',
      description: '查看你绑定的 GitHub 账号信息',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) {
          return '❌ 无法获取当前用户信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!existing) return '📭 你尚未绑定 GitHub 账号\n🔗 使用 github_bind 绑定你的账号';

        // 验证 token 是否仍然有效
        const userGh = new GhClient({ host: adapter.getHost(), token: existing.access_token });
        const auth = await userGh.verifyAuth();
        if (auth.ok) {
          return `👤 已绑定 GitHub 账号: ${auth.user}\n📅 绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`;
        }
        return `⚠️ 已绑定账号 ${existing.github_login}，但 Token 已失效\n🔗 请执行 github_unbind 后重新 github_bind`;
      },
    },
    // --- Install App ---
    {
      name: 'github_install',
      description: '获取安装 GitHub App 的链接 — 安装后 Bot 可以访问你的仓库，你也可以使用更多功能',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      tags: ['github'],
      execute: async () => {
        const slug = adapter.getAppSlug();
        if (!slug) return '❌ Bot 未配置 GitHub App';
        const host = adapter.getHost() || 'github.com';
        const installations = adapter.getInstallations();
        let msg = `🔗 请点击以下链接安装 GitHub App 到你的仓库：\n   https://${host}/apps/${slug}/installations/new`;
        if (installations.length) {
          msg += `\n\n📋 当前已安装 (${installations.length}):`;
          for (const inst of installations) {
            msg += `\n  • ${inst.account.login} (${inst.account.type})`;
          }
        }
        return msg;
      },
    },
    // --- Subscribe ---
    {
      name: 'github_subscribe',
      description: '订阅 GitHub 仓库的 Webhook 事件，事件将推送到当前聊天通道',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
          events: { type: 'string' as const, description: '要订阅的事件类型，逗号分隔 (push/issue/star/fork/unstar/pull_request)，默认全部' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const validEvents: EventType[] = ['push', 'issue', 'star', 'fork', 'unstar', 'pull_request'];
        const events: EventType[] = args.events
          ? args.events.split(',').map((s: string) => s.trim()).filter((e: string) => validEvents.includes(e as EventType))
          : validEvents;
        if (!events.length) return `❌ 无效的事件类型，可选: ${validEvents.join(', ')}`;

        const [existing] = await model.select().where({
          repo: args.repo,
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (existing) {
          await model.update({ events, target_type: context.scope || 'private' }).where({ id: existing.id });
          return `✅ 已更新订阅 ${args.repo}\n📡 事件: ${events.join(', ')}`;
        }

        await model.insert({
          id: Date.now(),
          repo: args.repo,
          events,
          target_id: context.sceneId,
          target_type: context.scope || 'private',
          adapter: context.platform,
          bot: context.botId,
        });
        return `✅ 已订阅 ${args.repo}\n📡 事件: ${events.join(', ')}\n📌 通知将推送到当前通道`;
      },
    },
    // --- Unsubscribe ---
    {
      name: 'github_unsubscribe',
      description: '取消订阅 GitHub 仓库的 Webhook 事件',
      parameters: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' as const, description: 'owner/repo (必填)' },
        },
        required: ['repo'],
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({
          repo: args.repo,
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (!existing) return `📭 当前通道未订阅 ${args.repo}`;

        await model.delete().where({ id: existing.id });
        return `✅ 已取消订阅 ${args.repo}`;
      },
    },
    // --- Subscriptions ---
    {
      name: 'github_subscriptions',
      description: '查看当前聊天通道的 GitHub 仓库订阅列表',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.sceneId || !context?.botId) {
          return '❌ 无法获取当前聊天通道信息';
        }
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_subscriptions');
        if (!model) return '❌ 数据库未就绪';

        const subs = await model.select().where({
          target_id: context.sceneId,
          adapter: context.platform,
          bot: context.botId,
        });
        if (!subs?.length) return '📭 当前通道没有任何 GitHub 订阅';

        return `📋 当前通道订阅 (${subs.length}):\n\n` +
          subs.map((s: any) => {
            const events = Array.isArray(s.events) ? s.events : [];
            return `  📦 ${s.repo}\n     📡 ${events.join(', ') || '(无事件)'}`;
          }).join('\n\n');
      },
    },
  ];

  const disposers = tools.map(t => toolService.addTool(t, plugin.name));
  logger.debug(`GitHub 工具已注册: ${tools.map(t => t.name).join(', ')}`);

  return () => disposers.forEach(d => d());
});

logger.debug('GitHub 适配器已加载 (gh CLI 认证)');
