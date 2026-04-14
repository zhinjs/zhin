/**
 * @zhin.js/devteam - GitHub 看板操作工具
 *
 * 提供给各 Agent 操作 GitHub Issues / Project 看板的 AI 工具
 */

import { ZhinTool } from 'zhin.js';
import type { GitHubClient } from '../github.js';
import type { RequirementStateMachine } from '../state-machine.js';
import type { AgentRoleValue, RequirementStatusValue } from '../types.js';
import { RequirementStatus, STATUS_LABELS, AgentRole } from '../types.js';

/**
 * 创建看板操作工具集
 */
export function createBoardTools(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
) {
  const createRequirement = new ZhinTool('devteam_create_requirement')
    .desc('创建新需求到 GitHub Project 看板。从用户反馈中整理出明确需求后使用')
    .keyword('创建需求', '新需求', '添加需求')
    .tag('devteam', 'board')
    .param('title', { type: 'string', description: '需求标题' }, true)
    .param('description', { type: 'string', description: '需求详细描述' }, true)
    .param('needsDesign', { type: 'boolean', description: '是否需要设计阶段（需要原型图）' }, true)
    .param('prototypeUrl', { type: 'string', description: '原型图链接（如果需要设计阶段）' })
    .param('labels', { type: 'string', description: '标签列表，逗号分隔' })
    .execute(async (args) => {
      const labels = args.labels ? (args.labels as string).split(',').map(s => s.trim()) : ['requirement'];
      if (!labels.includes('requirement')) labels.push('requirement');

      const issue = await github.createIssue(
        args.title as string,
        args.description as string,
        labels,
      );

      const itemId = await github.addIssueToProject(issue.node_id);

      const initialStatus = args.needsDesign
        ? RequirementStatus.WAITING_DESIGN
        : RequirementStatus.WAITING_REVIEW;

      stateMachine.register({
        issueNumber: issue.number,
        title: args.title as string,
        description: args.description as string,
        status: RequirementStatus.PENDING_TRIAGE,
        needsDesign: !!args.needsDesign,
        prototypeUrl: args.prototypeUrl as string | undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, itemId);

      await stateMachine.transition(
        issue.number,
        initialStatus,
        AgentRole.PROJECT_MANAGER,
      );

      return {
        success: true,
        issueNumber: issue.number,
        status: STATUS_LABELS[initialStatus],
        message: `需求 #${issue.number} 已创建并进入 ${STATUS_LABELS[initialStatus]} 状态`,
      };
    });

  const updateStatus = new ZhinTool('devteam_update_status')
    .desc('更新需求的看板状态。每个 Agent 根据自己的职责更新需求状态')
    .keyword('更新状态', '改变状态', '状态变更')
    .tag('devteam', 'board')
    .param('issueNumber', { type: 'number', description: '需求的 Issue 编号' }, true)
    .param('newStatus', {
      type: 'string',
      description: `新状态值。可选: ${Object.values(RequirementStatus).join(', ')}`,
    }, true)
    .param('agentRole', {
      type: 'string',
      description: `操作者角色: ${Object.values(AgentRole).join(', ')}`,
    }, true)
    .execute(async (args) => {
      const validStatuses = Object.values(RequirementStatus) as string[];
      if (!validStatuses.includes(args.newStatus as string)) {
        return {
          success: false,
          message: `无效的状态值: ${args.newStatus}。合法值: ${validStatuses.join(', ')}`,
        };
      }

      const validRoles = Object.values(AgentRole) as string[];
      if (!validRoles.includes(args.agentRole as string)) {
        return {
          success: false,
          message: `无效的角色: ${args.agentRole}。合法值: ${validRoles.join(', ')}`,
        };
      }

      const success = await stateMachine.transition(
        args.issueNumber as number,
        args.newStatus as RequirementStatusValue,
        args.agentRole as AgentRoleValue,
      );

      if (!success) {
        return {
          success: false,
          message: `状态更新失败: #${args.issueNumber} → ${args.newStatus}（可能是非法的状态转换）`,
        };
      }

      return {
        success: true,
        message: `需求 #${args.issueNumber} 状态已更新为 ${STATUS_LABELS[args.newStatus as RequirementStatusValue] || args.newStatus}`,
      };
    });

  const getRequirementInfo = new ZhinTool('devteam_get_requirement')
    .desc('获取需求的详细信息和当前状态')
    .keyword('查看需求', '需求详情', '需求状态')
    .tag('devteam', 'board')
    .param('issueNumber', { type: 'number', description: '需求的 Issue 编号' }, true)
    .execute(async (args) => {
      const req = stateMachine.get(args.issueNumber as number);
      if (!req) {
        return { error: `需求 #${args.issueNumber} 未找到` };
      }

      const issue = await github.getIssue(args.issueNumber as number);
      const comments = await github.getIssueComments(args.issueNumber as number);

      return {
        ...req,
        statusLabel: STATUS_LABELS[req.status],
        githubState: issue.state,
        labels: issue.labels.map(l => l.name),
        recentComments: comments.slice(-5).map(c => ({
          user: c.user.login,
          body: c.body.substring(0, 500),
          createdAt: c.created_at,
        })),
      };
    });

  const listRequirements = new ZhinTool('devteam_list_requirements')
    .desc('列出所有需求或按状态过滤')
    .keyword('需求列表', '所有需求', '查看看板')
    .tag('devteam', 'board')
    .param('status', { type: 'string', description: '按状态过滤（可选）' })
    .execute(async (args) => {
      let reqs = stateMachine.getAll();
      if (args.status) {
        reqs = reqs.filter(r => r.status === args.status);
      }
      return {
        total: reqs.length,
        requirements: reqs.map(r => ({
          issueNumber: r.issueNumber,
          title: r.title,
          status: r.status,
          statusLabel: STATUS_LABELS[r.status],
          needsDesign: r.needsDesign,
          updatedAt: new Date(r.updatedAt).toISOString(),
        })),
      };
    });

  const addComment = new ZhinTool('devteam_add_comment')
    .desc('在需求 Issue 上添加评论，用于 Agent 之间的沟通和讨论')
    .keyword('添加评论', '评论', '讨论', '@')
    .tag('devteam', 'board', 'communication')
    .param('issueNumber', { type: 'number', description: '需求的 Issue 编号' }, true)
    .param('comment', { type: 'string', description: '评论内容。可使用 @用户名 进行@提醒' }, true)
    .param('agentRole', { type: 'string', description: '发表评论的 Agent 角色' }, true)
    .execute(async (args) => {
      const roleEmoji: Record<string, string> = {
        project_manager: '📋',
        designer: '🎨',
        developer: '💻',
        tester: '🧪',
        ops: '🚀',
        director: '👔',
      };
      const emoji = roleEmoji[args.agentRole as string] || '🤖';
      const body = `${emoji} **[${args.agentRole}]**\n\n${args.comment}`;

      await github.addIssueComment(args.issueNumber as number, body);

      return {
        success: true,
        message: `已在 #${args.issueNumber} 添加评论`,
      };
    });

  return [
    createRequirement,
    updateStatus,
    getRequirementInfo,
    listRequirements,
    addComment,
  ];
}
