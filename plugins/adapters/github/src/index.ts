/**
 * GitHub 适配器入口：类型扩展、模型、导出、注册
 */
import { usePlugin, type Plugin, type Context, type ToolFeature, type Tool, type ToolContext } from 'zhin.js';
import { GitHubAdapter } from './adapter.js';
import type { EventType } from './types.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    github: GitHubAdapter;
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
  github_id: { type: 'integer', nullable: false },
  access_token: { type: 'text', nullable: false },
  scope: { type: 'text', default: '' },
  created_at: { type: 'date', nullable: false },
  updated_at: { type: 'date', nullable: false },
});

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via GitHub App',
  mounted: async (p: Plugin) => {
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: GitHubAdapter) => {
    await adapter.stop();
  },
} as Context<'github'>);

useContext('router', 'github', (router, adapter) => {
  adapter.setupWebhook(router);
  adapter.setupOAuth(router);
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      execute: async (args: Record<string, any>) => {
        const api = adapter.getAPI();
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
      description: 'Star 或取消 Star 一个 GitHub 仓库（需要先 github_bind 绑定账号）',
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
        if (!context?.platform || !context?.senderId) return '❌ 无法获取用户信息';
        const client = await adapter.getOAuthClient(context.platform, context.senderId);
        if (!client) return '❌ 你还没有绑定 GitHub 账号，请先使用 github_bind';
        const { action, repo } = args;
        switch (action) {
          case 'star': {
            const r = await client.starRepo(repo);
            return r.ok || r.status === 204 ? `⭐ 已 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'unstar': {
            const r = await client.unstarRepo(repo);
            return r.ok || r.status === 204 ? `💔 已取消 Star ${repo}` : `❌ ${r.data?.message || JSON.stringify(r.data)}`;
          }
          case 'check': {
            const starred = await client.isStarred(repo);
            return starred ? `⭐ 你已 Star ${repo}` : `☆ 你尚未 Star ${repo}`;
          }
          default: return `❌ 未知操作: ${action}`;
        }
      },
    },
    // --- Fork ---
    {
      name: 'github_fork',
      description: 'Fork 一个 GitHub 仓库到自己的账号下（需要先 github_bind 绑定账号）',
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
        if (!context?.platform || !context?.senderId) return '❌ 无法获取用户信息';
        const client = await adapter.getOAuthClient(context.platform, context.senderId);
        if (!client) return '❌ 你还没有绑定 GitHub 账号，请先使用 github_bind';
        const r = await client.forkRepo(args.repo);
        if (!r.ok) return `❌ ${r.data?.message || JSON.stringify(r.data)}`;
        return `🍴 已 Fork ${args.repo} → ${r.data.full_name}\n🔗 ${r.data.html_url}`;
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
    // --- Bind ---
    {
      name: 'github_bind',
      description: '绑定 GitHub 账号，生成 OAuth 授权链接',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) return '❌ 无法获取用户信息';

        // 检查是否已绑定
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (model) {
          const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
          if (existing) return `✅ 你已绑定 GitHub 账号: ${existing.github_login}\n如需重新绑定，请先使用 github_unbind 解绑`;
        }

        const url = adapter.createOAuthState(context.platform, context.senderId);
        if (!url) return '❌ GitHub App 未配置 OAuth (缺少 client_id)';

        return `🔗 请点击以下链接绑定你的 GitHub 账号:\n${url}\n\n链接有效期 5 分钟`;
      },
    },
    // --- Unbind ---
    {
      name: 'github_unbind',
      description: '解绑 GitHub 账号',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) return '❌ 无法获取用户信息';
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [existing] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!existing) return '📭 你还没有绑定 GitHub 账号';

        await model.delete().where({ id: existing.id });
        return `✅ 已解绑 GitHub 账号: ${existing.github_login}`;
      },
    },
    // --- Whoami ---
    {
      name: 'github_whoami',
      description: '查看当前绑定的 GitHub 账号信息',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
      platforms: ['github'],
      tags: ['github'],
      execute: async (_args: Record<string, any>, context?: ToolContext) => {
        if (!context?.platform || !context?.senderId) return '❌ 无法获取用户信息';
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const [row] = await model.select().where({ platform: context.platform, platform_uid: context.senderId });
        if (!row) return '📭 你还没有绑定 GitHub 账号，使用 github_bind 进行绑定';

        return [
          `🐙 GitHub 账号信息`,
          `👤 用户名: ${row.github_login}`,
          `🆔 GitHub ID: ${row.github_id}`,
          `📅 绑定时间: ${row.created_at instanceof Date ? row.created_at.toLocaleDateString() : String(row.created_at).split('T')[0]}`,
          `🔑 权限: ${row.scope || '(默认)'}`,
        ].join('\n');
      },
    },
  ];

  const disposers = tools.map(t => toolService.addTool(t, 'github'));
  logger.debug(`GitHub 工具已注册: ${tools.map(t => t.name).join(', ')}`);

  return () => disposers.forEach(d => d());
});

logger.debug('GitHub 适配器已加载 (GitHub App 认证)');
