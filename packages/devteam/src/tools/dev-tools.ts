/**
 * @zhin.js/devteam - 开发工具
 *
 * 提供给开发者和运维 Agent 的代码管理工具（分支、PR、CI/CD）
 */

import { ZhinTool } from 'zhin.js';
import type { GitHubClient } from '../github.js';
import type { RequirementStateMachine } from '../state-machine.js';

/**
 * 创建开发相关工具集
 */
export function createDevTools(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  productionBranch: string,
) {
  const createBranch = new ZhinTool('devteam_create_branch')
    .desc('从生产分支创建开发分支，用于需求开发')
    .keyword('创建分支', '切分支', '新分支')
    .tag('devteam', 'git')
    .param('issueNumber', { type: 'number', description: '关联的需求 Issue 编号' }, true)
    .param('branchName', { type: 'string', description: '分支名称（如 feat/issue-123-user-login）' }, true)
    .execute(async (args) => {
      const branchName = args.branchName as string;
      try {
        await github.createBranch(branchName, productionBranch);
        stateMachine.update(args.issueNumber as number, { branchName });
        return {
          success: true,
          branchName,
          message: `分支 ${branchName} 已从 ${productionBranch} 创建`,
        };
      } catch (err) {
        return {
          success: false,
          error: `创建分支失败: ${err}`,
        };
      }
    });

  const createPR = new ZhinTool('devteam_create_pr')
    .desc('创建 Pull Request，将开发分支合并到目标分支')
    .keyword('创建PR', 'pull request', '提交合并')
    .tag('devteam', 'git')
    .param('issueNumber', { type: 'number', description: '关联的需求 Issue 编号' }, true)
    .param('title', { type: 'string', description: 'PR 标题' }, true)
    .param('body', { type: 'string', description: 'PR 描述' }, true)
    .param('head', { type: 'string', description: '源分支名' }, true)
    .param('base', { type: 'string', description: `目标分支名（默认 ${productionBranch}）` })
    .execute(async (args) => {
      const base = (args.base as string) || productionBranch;
      try {
        const pr = await github.createPullRequest(
          args.title as string,
          `Closes #${args.issueNumber}\n\n${args.body}`,
          args.head as string,
          base,
        );
        stateMachine.update(args.issueNumber as number, { prNumber: pr.number });
        return {
          success: true,
          prNumber: pr.number,
          url: pr.html_url,
          message: `PR #${pr.number} 已创建: ${pr.html_url}`,
        };
      } catch (err) {
        return {
          success: false,
          error: `创建 PR 失败: ${err}`,
        };
      }
    });

  const mergePR = new ZhinTool('devteam_merge_pr')
    .desc('合并 Pull Request 到目标分支（运维使用）')
    .keyword('合并PR', '合并分支', 'merge')
    .tag('devteam', 'git', 'ops')
    .param('prNumber', { type: 'number', description: 'PR 编号' }, true)
    .param('mergeMethod', { type: 'string', description: '合并方式: merge, squash, rebase（默认 squash）' })
    .execute(async (args) => {
      try {
        const method = (args.mergeMethod as 'merge' | 'squash' | 'rebase') || 'squash';
        await github.mergePullRequest(args.prNumber as number, method);
        return {
          success: true,
          message: `PR #${args.prNumber} 已合并`,
        };
      } catch (err) {
        return {
          success: false,
          error: `合并 PR 失败: ${err}`,
        };
      }
    });

  const checkCI = new ZhinTool('devteam_check_ci')
    .desc('检查 CI/CD 流水线状态')
    .keyword('CI状态', '流水线', '部署状态', 'CI/CD')
    .tag('devteam', 'ci')
    .param('branchName', { type: 'string', description: '要检查的分支名（可选）' })
    .execute(async (args) => {
      try {
        const runs = await github.getWorkflowRuns(args.branchName as string | undefined);
        return {
          runs: runs.map(r => ({
            id: r.id,
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            url: r.html_url,
          })),
          message: runs.length ? `找到 ${runs.length} 条流水线记录` : '暂无流水线记录',
        };
      } catch (err) {
        return { error: `查询 CI 状态失败: ${err}` };
      }
    });

  const getPRStatus = new ZhinTool('devteam_get_pr_status')
    .desc('获取 Pull Request 的状态和详细信息')
    .keyword('PR状态', 'PR详情')
    .tag('devteam', 'git')
    .param('prNumber', { type: 'number', description: 'PR 编号' }, true)
    .execute(async (args) => {
      try {
        const pr = await github.getPullRequest(args.prNumber as number);
        return {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          url: pr.html_url,
          head: pr.head.ref,
          base: pr.base.ref,
          mergeable: pr.mergeable,
        };
      } catch (err) {
        return { error: `获取 PR 状态失败: ${err}` };
      }
    });

  return [
    createBranch,
    createPR,
    mergePR,
    checkCI,
    getPRStatus,
  ];
}
