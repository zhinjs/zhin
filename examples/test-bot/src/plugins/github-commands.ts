/**
 * GitHub 普通指令插件
 *
 * 让用户通过聊天命令（而非 AI Skill）直接操控 GitHub。
 * 依赖 github adapter Context，adapter 就绪后自动注册命令。
 */
import { usePlugin, MessageCommand } from 'zhin.js';
import type { GitHubAdapter } from '@zhin.js/adapter-github';
import { GhClient } from '@zhin.js/adapter-github';

const plugin = usePlugin();
const { addCommand, useContext, logger } = plugin;

// ── 辅助：从 message 中拿用户身份，获取对应 GhClient ──────────────
async function getAPI(adapter: GitHubAdapter, message: any): Promise<GhClient | null> {
  return adapter.getUserOrDefaultAPI(message.$adapter, message.$sender?.id);
}

// ══════════════════════════════════════════════════════════════════
// 1. gh — 主入口  gh <子命令>
// ══════════════════════════════════════════════════════════════════

addCommand(
  new MessageCommand('gh help')
    .desc('GitHub 快捷指令帮助')
    .action(() => {
      return [
        '📦 GitHub 指令列表：',
        '',
        '  gh repo <owner/repo>           — 查看仓库信息',
        '  gh issues <owner/repo>         — 列出 Issue',
        '  gh issue <owner/repo> <编号>   — 查看某个 Issue',
        '  gh prs <owner/repo>            — 列出 PR',
        '  gh pr <owner/repo> <编号>      — 查看某个 PR',
        '  gh search <关键词>             — 搜索仓库',
        '  gh star <owner/repo>           — Star 仓库',
        '  gh unstar <owner/repo>         — 取消 Star',
        '  gh commits <owner/repo> [数量] — 查看提交记录',
        '  gh branches <owner/repo>       — 查看分支',
        '  gh releases <owner/repo>       — 查看发布',
        '  gh ci <owner/repo>             — 查看 CI 状态',
        '  gh comment <owner/repo> <编号> <内容> — 评论 Issue/PR',
        '  gh close <owner/repo> <编号>   — 关闭 Issue/PR',
        '  gh bind [Token]               — 绑定 GitHub 账号 (PAT 或 Device Flow)',
        '  gh unbind                      — 解绑 GitHub 账号',
        '  gh whoami                      — 查看绑定状态',
      ].join('\n');
    }),
);

// ══════════════════════════════════════════════════════════════════
// 子命令：仓库信息
// ══════════════════════════════════════════════════════════════════

useContext('github', (adapter: GitHubAdapter) => {

  addCommand(
    new MessageCommand('gh repo <repo:text>')
      .desc('查看仓库信息')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.getRepo(result.params.repo);
        if (!r.ok) return `❌ ${r.data?.message || '仓库不存在'}`;
        const d = r.data;
        return [
          `📦 ${d.full_name}${d.private ? ' 🔒' : ''}`,
          d.description ? `📝 ${d.description}` : null,
          `⭐ ${d.stargazers_count} | 🍴 ${d.forks_count} | 👀 ${d.watchers_count}`,
          `🌿 默认分支: ${d.default_branch}`,
          d.language ? `💻 语言: ${d.language}` : null,
          d.license ? `📄 ${d.license.name}` : null,
          `📅 创建: ${d.created_at?.split('T')[0]} | 推送: ${d.pushed_at?.split('T')[0]}`,
          `🔗 ${d.html_url}`,
        ].filter(Boolean).join('\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：Issue 列表
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh issues <repo:text>')
      .desc('列出 Issue')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.listIssues(result.params.repo, 'open');
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        const issues = r.data.filter((i: any) => !i.pull_request);
        if (!issues.length) return '📭 没有 open 状态的 Issue';
        return issues.slice(0, 15).map((i: any) => {
          const lbls = i.labels?.map((l: any) => l.name).join(', ') || '';
          return `#${i.number} ${i.title}\n   👤 ${i.user.login}${lbls ? ` | 🏷️ ${lbls}` : ''}`;
        }).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：查看单个 Issue
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh issue <repo:text> <number:number>')
      .desc('查看 Issue 详情')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.getIssue(result.params.repo, result.params.number);
        if (!r.ok) return `❌ ${r.data?.message || 'Issue 不存在'}`;
        const i = r.data;
        return [
          `#${i.number} ${i.title}`,
          `👤 ${i.user.login} | ${i.state} | 📅 ${i.created_at?.split('T')[0]}`,
          i.labels?.length ? `🏷️ ${i.labels.map((l: any) => l.name).join(', ')}` : null,
          i.body ? `\n${i.body.slice(0, 800)}${i.body.length > 800 ? '...' : ''}` : '',
          `\n🔗 ${i.html_url}`,
        ].filter(Boolean).join('\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：PR 列表
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh prs <repo:text>')
      .desc('列出 Pull Request')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.listPRs(result.params.repo, 'open');
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        if (!r.data.length) return '📭 没有 open 状态的 PR';
        return r.data.slice(0, 15).map((p: any) =>
          `#${p.number} ${p.draft ? '[Draft] ' : ''}${p.title}\n   👤 ${p.user.login} | 🌿 ${p.head.ref} → ${p.base.ref}`,
        ).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：查看单个 PR
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh pr <repo:text> <number:number>')
      .desc('查看 PR 详情')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.getPR(result.params.repo, result.params.number);
        if (!r.ok) return `❌ ${r.data?.message || 'PR 不存在'}`;
        const p = r.data;
        return [
          `#${p.number} ${p.title}`,
          `👤 ${p.user.login} | ${p.state} | 🌿 ${p.head.ref} → ${p.base.ref}`,
          `📅 ${p.created_at?.split('T')[0]} | +${p.additions} -${p.deletions} (${p.changed_files} files)`,
          p.body ? `\n${p.body.slice(0, 800)}${p.body.length > 800 ? '...' : ''}` : '',
          `\n🔗 ${p.html_url}`,
        ].filter(Boolean).join('\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：搜索仓库
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh search <query:text>')
      .desc('搜索 GitHub 仓库')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.searchRepos(result.params.query, 10);
        if (!r.ok) return `❌ ${r.data?.message || '搜索失败'}`;
        if (!r.data.items?.length) return '📭 没有匹配的仓库';
        return `🔍 共 ${r.data.total_count} 条，显示前 ${r.data.items.length}:\n\n` +
          r.data.items.map((repo: any) =>
            `📦 ${repo.full_name}  ⭐ ${repo.stargazers_count}\n   ${repo.description || '(无描述)'}`,
          ).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：Star / Unstar
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh star <repo:text>')
      .desc('Star 仓库')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.starRepo(result.params.repo);
        return r.ok ? `⭐ 已 Star ${result.params.repo}` : `❌ ${r.data?.message || 'Star 失败'}`;
      }),
  );

  addCommand(
    new MessageCommand('gh unstar <repo:text>')
      .desc('取消 Star')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.unstarRepo(result.params.repo);
        return r.ok ? `💔 已取消 Star ${result.params.repo}` : `❌ ${r.data?.message || '操作失败'}`;
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：提交记录
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh commits <repo:text> [limit:number]')
      .desc('查看提交记录')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const limit = result.params.limit || 10;
        const r = await api.listCommits(result.params.repo, undefined, undefined, limit);
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        if (!r.data.length) return '📭 没有找到提交记录';
        return r.data.map((c: any) =>
          `• ${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}\n  👤 ${c.commit.author?.name || '?'} | 📅 ${c.commit.author?.date?.split('T')[0] || '?'}`,
        ).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：分支
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh branches <repo:text>')
      .desc('查看分支列表')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.listBranches(result.params.repo, 20);
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        return r.data.length
          ? `🌿 分支 (${r.data.length}):\n${r.data.map((b: any) => `  • ${b.name}${b.protected ? ' 🔒' : ''}`).join('\n')}`
          : '没有找到分支';
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：发布
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh releases <repo:text>')
      .desc('查看发布列表')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.listReleases(result.params.repo, 10);
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        if (!r.data.length) return '📭 暂无发布';
        return r.data.map((rel: any) =>
          `${rel.prerelease ? '🧪' : '📦'} ${rel.tag_name} — ${rel.name || '(no title)'}\n   📅 ${rel.published_at?.split('T')[0]} | 👤 ${rel.author?.login}`,
        ).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：CI
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh ci <repo:text>')
      .desc('查看 CI / Actions 状态')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.listWorkflowRuns(result.params.repo, 10);
        if (!r.ok) return `❌ ${r.data?.message || '查询失败'}`;
        const runs = r.data.workflow_runs || [];
        if (!runs.length) return '📭 暂无 CI 记录';
        return runs.map((run: any) => {
          const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.status === 'in_progress' ? '🔄' : '⏳';
          return `${icon} #${run.id} ${run.display_title}\n   🌿 ${run.head_branch} | ${run.status}${run.conclusion ? '/' + run.conclusion : ''}`;
        }).join('\n\n');
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：评论
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh comment <repo:text> <number:number> <body:text>')
      .desc('评论 Issue 或 PR')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        const r = await api.createIssueComment(result.params.repo, result.params.number, result.params.body);
        return r.ok ? `✅ 已评论 #${result.params.number}` : `❌ ${r.data?.message || '评论失败'}`;
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：关闭 Issue/PR
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh close <repo:text> <number:number>')
      .desc('关闭 Issue 或 PR')
      .action(async (message, result) => {
        const api = await getAPI(adapter, message);
        if (!api) return '❌ GitHub 未就绪';
        // 先尝试 Issue，再尝试 PR
        const ir = await api.closeIssue(result.params.repo, result.params.number);
        if (ir.ok) return `✅ Issue #${result.params.number} 已关闭`;
        const pr = await api.closePR(result.params.repo, result.params.number);
        if (pr.ok) return `✅ PR #${result.params.number} 已关闭`;
        return `❌ 关闭失败: ${ir.data?.message || pr.data?.message || '未知错误'}`;
      }),
  );

  // ══════════════════════════════════════════════════════════════════
  // 子命令：绑定 / 解绑 / whoami
  // ══════════════════════════════════════════════════════════════════

  addCommand(
    new MessageCommand('gh bind [token:text]')
      .desc('绑定你的 GitHub 账号')
      .action(async (message, result) => {
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';

        const platform = message.$adapter;
        const uid = message.$sender?.id;
        if (!platform || !uid) return '❌ 无法获取用户信息';

        const [existing] = await model.select().where({ platform, platform_uid: uid });
        if (existing) return `⚠️ 已绑定 GitHub 账号: ${existing.github_login}\n先执行 gh unbind 解绑`;

        const host = adapter.getHost();
        const token = result.params.token?.trim();

        // ── 方式 1: PAT 直接绑定 ──────────────────────────────
        if (token) {
          const userGh = new GhClient({ host, token });
          const auth = await userGh.verifyAuth();
          if (!auth.ok) return `❌ Token 验证失败: ${auth.message}\n请检查 Token 是否有效`;
          await model.insert({
            id: Date.now(),
            platform,
            platform_uid: uid,
            github_login: auth.user,
            access_token: token,
            created_at: Date.now(),
          });
          return `✅ GitHub 绑定成功！\n👤 ${auth.user}`;
        }

        // ── 方式 2: Device Flow ───────────────────────────────
        const clientId = adapter.getClientId();
        if (!clientId) {
          return [
            '❌ Device Flow 不可用（App 未配置 client_id）',
            '',
            '你可以使用 PAT 直接绑定：',
            '1. 访问 https://github.com/settings/tokens/new',
            '2. 勾选 repo, read:org 权限，生成 Token',
            '3. 执行: gh bind <你的Token>',
          ].join('\n');
        }

        let codeResp;
        try {
          codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
        } catch (e: any) {
          return [
            `❌ Device Flow 失败: ${e.message || '未知错误'}`,
            '',
            '你也可以用 PAT 直接绑定：',
            '1. 访问 https://github.com/settings/tokens/new',
            '2. 勾选 repo, read:org 权限，生成 Token',
            '3. 执行: gh bind <你的Token>',
          ].join('\n');
        }

        // 后台轮询 token
        GhClient.deviceFlowPollToken(
          clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
        ).then(async (tokenData) => {
          if (!tokenData) {
            logger.warn(`GitHub Device Flow 超时: ${platform}:${uid}`);
            return;
          }
          const userGh = new GhClient({ host, token: tokenData.access_token });
          const auth = await userGh.verifyAuth();
          const login = auth.ok ? auth.user : 'unknown';
          await model.insert({
            id: Date.now(),
            platform,
            platform_uid: uid,
            github_login: login,
            access_token: tokenData.access_token,
            created_at: Date.now(),
          });
          logger.info(`GitHub 绑定成功: ${platform}:${uid} → ${login}`);
          if (message.$reply) {
            await message.$reply(`✅ GitHub 绑定成功！\n👤 ${login}`);
          }
        }).catch(err => logger.error('Device Flow 错误:', err));

        return [
          `🔗 请在浏览器中打开：`,
          `   ${codeResp.verification_uri}`,
          ``,
          `📋 输入验证码: ${codeResp.user_code}`,
          ``,
          `⏳ ${Math.floor(codeResp.expires_in / 60)} 分钟内有效`,
        ].join('\n');
      }),
  );

  addCommand(
    new MessageCommand('gh unbind')
      .desc('解绑 GitHub 账号')
      .action(async (message) => {
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';
        const platform = message.$adapter;
        const uid = message.$sender?.id;
        if (!platform || !uid) return '❌ 无法获取用户信息';
        const [existing] = await model.select().where({ platform, platform_uid: uid });
        if (!existing) return '📭 尚未绑定 GitHub 账号';
        await model.delete().where({ id: existing.id });
        return `✅ 已解绑: ${existing.github_login}`;
      }),
  );

  addCommand(
    new MessageCommand('gh whoami')
      .desc('查看绑定的 GitHub 账号')
      .action(async (message) => {
        const db = plugin.root?.inject('database') as any;
        const model = db?.models?.get('github_oauth_users');
        if (!model) return '❌ 数据库未就绪';
        const platform = message.$adapter;
        const uid = message.$sender?.id;
        if (!platform || !uid) return '❌ 无法获取用户信息';
        const [existing] = await model.select().where({ platform, platform_uid: uid });
        if (!existing) return '📭 尚未绑定\n使用 gh bind 绑定你的 GitHub 账号';
        const userGh = new GhClient({ host: adapter.getHost(), token: existing.access_token });
        const auth = await userGh.verifyAuth();
        if (auth.ok) {
          return `👤 已绑定: ${auth.user}\n📅 绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`;
        }
        return `⚠️ 已绑定 ${existing.github_login}，但 Token 已失效\n请 gh unbind 后重新 gh bind`;
      }),
  );

  logger.info('GitHub 命令插件已注册');
});
