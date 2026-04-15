/**
 * @zhin.js/devteam - Agent 编排器
 *
 * 将状态变更事件路由到对应 Agent 角色进行处理。
 *
 * AI 模式（有 AIService）:
 *   只调 runAgent()，由 Agent 自己使用 devteam_* 工具评论和变更状态。
 *   编排器不做任何自动 transition。
 *
 * 规则式退化（无 AIService）:
 *   只做当前步骤的最小动作（发评论说明待办），不连续跳多个状态。
 */

import { Logger } from 'zhin.js';
import type { StatusChangeEvent, AgentRoleValue, Requirement, AgentAppConfig } from './types.js';
import { RequirementStatus, AgentRole, STATUS_LABELS } from './types.js';
import type { DevTeamEventBus } from './event-bus.js';
import type { RequirementStateMachine } from './state-machine.js';
import type { GitHubClient } from './github.js';

const logger = new Logger(null, 'DevTeam:Orchestrator');

/** AIService 的最小接口 */
interface AIServiceLike {
  runAgent(task: string, options?: { systemPrompt?: string; tools?: any[] }): Promise<{ content: string; toolCalls: any[]; usage: any }>;
}

// ============================================================================
// 编排器
// ============================================================================

export class DevTeamOrchestrator {
  private processing: Set<string> = new Set();
  private ai: AIServiceLike | null = null;
  private tools: any[] = [];
  /** 各角色的独立 GitHub 客户端 */
  private roleClients: Map<AgentRoleValue, GitHubClient> = new Map();

  constructor(
    private github: GitHubClient,
    private stateMachine: RequirementStateMachine,
    private eventBus: DevTeamEventBus,
    private productionBranch: string,
    agentConfigs?: Partial<Record<AgentRoleValue, AgentAppConfig>>,
  ) {
    this.buildRoleClients(agentConfigs);
    this.setupEventRouting();
  }

  /**
   * 注入 AIService 和工具集。
   */
  setAI(ai: AIServiceLike | null, tools?: any[]): void {
    this.ai = ai;
    this.tools = tools || [];
    logger.info(ai ? 'AI 子代理模式已启用' : 'AI 子代理模式已关闭，使用规则式处理');
  }

  /**
   * 为配置了独立认证的角色创建专属 GitHubClient。
   */
  private buildRoleClients(configs?: Partial<Record<AgentRoleValue, AgentAppConfig>>): void {
    if (!configs) return;
    for (const [role, appConfig] of Object.entries(configs) as [AgentRoleValue, AgentAppConfig][]) {
      if (!appConfig) continue;
      const client = this.github.forRole(appConfig);
      if (client !== this.github) {
        this.roleClients.set(role, client);
        logger.info(`角色 ${role} 使用独立 GitHub App 认证`);
      }
    }
  }

  /** 获取某角色的 GitHub 客户端（有独立配置用独立的，否则用共享的） */
  private ghFor(role: AgentRoleValue): GitHubClient {
    return this.roleClients.get(role) || this.github;
  }

  private setupEventRouting(): void {
    const allRoles: AgentRoleValue[] = [
      AgentRole.PROJECT_MANAGER,
      AgentRole.DESIGNER,
      AgentRole.DEVELOPER,
      AgentRole.TESTER,
      AgentRole.OPS,
    ];
    for (const role of allRoles) {
      this.eventBus.onRole(role, async (event) => {
        const eventKey = `${event.issueNumber}:${event.to}:${role}`;
        if (this.processing.has(eventKey)) {
          logger.debug(`跳过重复处理: ${eventKey}`);
          return;
        }
        this.processing.add(eventKey);
        try {
          const result = await this.dispatch(role, event);
          logger.info(`[${role}] 处理完成: ${result}`);
        } catch (err) {
          logger.error(`[${role}] 处理失败 #${event.issueNumber}:`, err);
          try {
            await this.ghFor(role).addIssueComment(event.issueNumber,
              `⚠️ **[系统]** ${role} 处理需求时出错: ${err}`,
            );
          } catch { /* ignore */ }
        } finally {
          this.processing.delete(eventKey);
        }
      });
    }
  }

  /**
   * 分发事件：AI 模式优先，失败退化到规则式。
   */
  private async dispatch(role: AgentRoleValue, event: StatusChangeEvent): Promise<string> {
    const req = this.stateMachine.get(event.issueNumber);
    const gh = this.ghFor(role);

    // ── AI 模式：把控制权完全交给 Agent ──
    if (this.ai) {
      const prompt = ROLE_PROMPTS[role];
      if (prompt) {
        const task = buildAgentTask(ROLE_NAMES[role], event, req);
        try {
          const result = await this.ai.runAgent(task, {
            systemPrompt: prompt,
            tools: this.tools,
          });
          // Agent 已通过工具自行评论/转状态，这里只返回摘要
          return result.content || `${ROLE_NAMES[role]} AI 处理完成: #${event.issueNumber}`;
        } catch (err) {
          logger.warn(`[${role}] AI 调用失败，退化为规则处理:`, err);
        }
      }
    }

    // ── 规则式退化：只做最小动作，不连续跳状态 ──
    return this.fallback(role, event, gh);
  }

  /**
   * 规则式退化处理。
   * 原则：每次只做当前步骤的最小必要动作 + 发一条评论说明下一步待办。
   * 绝不连续 transition 多个状态。
   */
  private async fallback(role: AgentRoleValue, event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    switch (role) {
      case AgentRole.PROJECT_MANAGER:
        return this.fallbackPM(event, gh);
      case AgentRole.DESIGNER:
        return this.fallbackDesigner(event, gh);
      case AgentRole.DEVELOPER:
        return this.fallbackDeveloper(event, gh);
      case AgentRole.TESTER:
        return this.fallbackTester(event, gh);
      case AgentRole.OPS:
        return this.fallbackOps(event, gh);
      default:
        return `${ROLE_NAMES[role] || role} 收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 各角色的规则式退化（只做当前步骤，不连续跳）
  // ────────────────────────────────────────────────────────────────────

  private async fallbackPM(event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    switch (event.to) {
      case RequirementStatus.IN_REVIEW: {
        const comments = await gh.getIssueComments(event.issueNumber);
        const recent = comments.slice(-5).map(c => `${c.user.login}: ${c.body.substring(0, 100)}`).join('\n');
        await gh.addIssueComment(event.issueNumber,
          `📋 **[项目经理]** 需求评审已开始\n\n` +
          `请各位从专业角度参与讨论：\n` +
          `- 💻 开发：确认技术可行性\n` +
          `- 🧪 测试：准备测试用例\n` +
          `- 🎨 设计：确认设计完整性\n\n` +
          (recent ? `近期评论:\n${recent}` : '') +
          `\n\n⏳ **待办**: 各方讨论对齐后，使用 \`devteam_update_status\` 推进到「评审完成」`,
        );
        return `项目经理已开启评审: #${event.issueNumber}`;
      }
      case RequirementStatus.WAITING_ACCEPTANCE:
        await gh.addIssueComment(event.issueNumber,
          `📋 **[项目经理]** 需求已部署到生产环境，开始验收\n\n` +
          `验收检查项：\n` +
          `- [ ] 功能是否符合需求描述\n` +
          `- [ ] 用户体验是否达标\n` +
          `- [ ] 是否有明显缺陷\n\n` +
          `⏳ **待办**: 验收通过后，使用 \`devteam_update_status\` 标记为「已完成」`,
        );
        return `项目经理开始验收: #${event.issueNumber}`;
      default:
        return `项目经理收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  private async fallbackDesigner(event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    const req = this.stateMachine.get(event.issueNumber);
    switch (event.to) {
      case RequirementStatus.WAITING_DESIGN:
        await gh.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 收到设计需求\n\n` +
          `原型图: ${req?.prototypeUrl || '待提供'}\n\n` +
          `⏳ **待办**: 完成设计稿后，使用 \`devteam_update_status\` 推进到「等待评审」`,
        );
        return `设计师已接收设计任务: #${event.issueNumber}`;
      case RequirementStatus.IN_REVIEW:
        await gh.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 从设计角度参与评审\n\n` +
          `确认需求可行性和设计完整性。`,
        );
        return `设计师参与评审: #${event.issueNumber}`;
      case RequirementStatus.WAITING_WALKTHROUGH:
        await gh.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 开始走查开发实现\n\n` +
          `对照设计稿检查：\n` +
          `- [ ] 布局和间距\n` +
          `- [ ] 颜色和字体\n` +
          `- [ ] 交互效果\n` +
          `- [ ] 响应式适配\n\n` +
          `⏳ **待办**: 走查完成后，使用 \`devteam_update_status\` 标记「走查通过」或「走查不通过」`,
        );
        return `设计师开始走查: #${event.issueNumber}`;
      default:
        return `设计师收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  private async fallbackDeveloper(event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    const req = this.stateMachine.get(event.issueNumber);
    switch (event.to) {
      case RequirementStatus.WAITING_REVIEW:
        await gh.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 开始评审需求\n\n` +
          `正在理解需求细节，如有疑问将在评论中讨论。\n\n` +
          `⏳ **待办**: 理解完毕后，使用 \`devteam_update_status\` 推进到「评审中」`,
        );
        return `开发人员开始评审: #${event.issueNumber}`;
      case RequirementStatus.IN_REVIEW:
        await gh.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 参与需求评审讨论\n\n` +
          `从技术视角评估可行性和工作量。`,
        );
        return `开发人员参与评审: #${event.issueNumber}`;
      case RequirementStatus.WAITING_DEV: {
        // 创建分支是纯机械动作，可以自动执行
        const slug = event.title
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30);
        const branchName = `feat/issue-${event.issueNumber}-${slug}`;
        try {
          await gh.createBranch(branchName, this.productionBranch);
          this.stateMachine.update(event.issueNumber, { branchName });
        } catch (err: unknown) {
          if (!String(err).includes('Reference already exists')) {
            logger.error(`分支创建失败: ${branchName}`, err);
          }
        }
        await gh.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 已创建开发分支 \`${branchName}\`\n\n` +
          `⏳ **待办**: 开发完成后，使用 \`devteam_create_pr\` 创建 PR，` +
          `然后 \`devteam_update_status\` 推进到「等待走查」`,
        );
        return `开发人员已创建分支: ${branchName}`;
      }
      case RequirementStatus.WALKTHROUGH_FAILED:
        await gh.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 收到走查反馈，开始修复\n\n` +
          `⏳ **待办**: 修复完成后，使用 \`devteam_update_status\` 重新进入「等待走查」`,
        );
        return `开发人员开始修复: #${event.issueNumber}`;
      case RequirementStatus.WALKTHROUGH_PASSED:
        await gh.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 走查已通过，开始按冒烟用例自测\n\n` +
          `⏳ **待办**: 自测通过后，使用 \`devteam_update_status\` 推进到「等待测试」`,
        );
        return `开发人员开始自测: #${event.issueNumber}`;
      default:
        return `开发人员收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  private async fallbackTester(event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    switch (event.to) {
      case RequirementStatus.IN_REVIEW:
        await gh.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 参与需求评审\n\n` +
          `正在分析测试点，将准备冒烟和完整测试用例。`,
        );
        return `测试人员参与评审: #${event.issueNumber}`;
      case RequirementStatus.REVIEW_DONE:
        await gh.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 开始编写测试用例\n\n` +
          `⏳ **待办**: 用例编写完成后，使用 \`devteam_update_status\` 推进到「等待开发」`,
        );
        return `测试人员开始准备用例: #${event.issueNumber}`;
      case RequirementStatus.WAITING_TEST:
        await gh.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 开始执行完整测试\n\n` +
          `测试范围：功能 / 边界 / 异常 / 兼容性\n\n` +
          `⏳ **待办**: 全部通过后，使用 \`devteam_update_status\` 推进到「等待上线」`,
        );
        return `测试人员开始测试: #${event.issueNumber}`;
      default:
        return `测试人员收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  private async fallbackOps(event: StatusChangeEvent, gh: GitHubClient): Promise<string> {
    const req = this.stateMachine.get(event.issueNumber);
    switch (event.to) {
      case RequirementStatus.WAITING_DEPLOY: {
        if (!req?.prNumber) {
          await gh.addIssueComment(event.issueNumber,
            `🚀 **[运维]** 未找到关联 PR，无法部署。请开发人员先创建 PR。`,
          );
          return `运维未找到 PR: #${event.issueNumber}`;
        }
        await gh.addIssueComment(event.issueNumber,
          `🚀 **[运维]** 收到上线请求，PR #${req.prNumber}\n\n` +
          `⏳ **待办**: 检查 CI 状态，合并 PR 后使用 \`devteam_update_status\` 推进到「等待验收」`,
        );
        return `运维收到上线请求: #${event.issueNumber}`;
      }
      default:
        return `运维收到事件: ${STATUS_LABELS[event.to]}`;
    }
  }

  dispose(): void {
    this.processing.clear();
    this.roleClients.clear();
  }
}

// ============================================================================
// 角色名称映射
// ============================================================================

const ROLE_NAMES: Record<AgentRoleValue, string> = {
  [AgentRole.DIRECTOR]: '总监',
  [AgentRole.PROJECT_MANAGER]: '项目经理',
  [AgentRole.DESIGNER]: '设计师',
  [AgentRole.DEVELOPER]: '开发人员',
  [AgentRole.TESTER]: '测试人员',
  [AgentRole.OPS]: '运维人员',
};

// ============================================================================
// AI Agent 任务构建
// ============================================================================

function buildAgentTask(
  roleName: string,
  event: StatusChangeEvent,
  req: Requirement | undefined,
): string {
  const lines: string[] = [
    `你是「${roleName}」，负责处理以下状态变更事件。`,
    `请使用 devteam_* 工具完成实际操作（评论、状态变更等），不要只描述你会做什么。`,
    '',
    `## 事件`,
    `- 需求 Issue: #${event.issueNumber}`,
    `- 标题: ${event.title}`,
    `- 状态变更: [${STATUS_LABELS[event.from]}] → [${STATUS_LABELS[event.to]}]`,
    `- 触发者: ${event.triggeredBy}`,
  ];

  if (req) {
    lines.push('', `## 需求详情`, `- 描述: ${req.description || '无'}`);
    if (req.needsDesign) lines.push(`- 需要设计阶段: 是`);
    if (req.branchName) lines.push(`- 开发分支: ${req.branchName}`);
    if (req.prNumber) lines.push(`- PR: #${req.prNumber}`);
    if (req.prototypeUrl) lines.push(`- 原型图: ${req.prototypeUrl}`);
    if (req.designUrl) lines.push(`- 设计稿: ${req.designUrl}`);
  }

  lines.push(
    '',
    `## 注意`,
    `- 用 devteam_add_comment 发表评论（以你的角色身份）`,
    `- 用 devteam_update_status 变更需求状态（只有当你真正完成了当前步骤的工作时才变更）`,
    `- 用 devteam_get_requirement 获取需求详情`,
    `- 如果当前步骤需要实际工作（如编码、测试、设计），请先完成工作再推进状态`,
  );

  return lines.join('\n');
}

// ============================================================================
// 各角色的 AI System Prompt
// ============================================================================

const ROLE_PROMPTS: Partial<Record<AgentRoleValue, string>> = {
  [AgentRole.PROJECT_MANAGER]: `你是项目经理，负责需求整理、评审协调和验收确认。

## 可用工具
devteam_create_requirement, devteam_update_status, devteam_get_requirement,
devteam_list_requirements, devteam_add_comment, devteam_list_feedback,
devteam_mark_feedback_processed

## 处理原则
- 评审中(in_review): 阅读已有评论，协调各方讨论，确保需求描述清晰
- 等待验收(waiting_acceptance): 验证需求完成度——检查 PR 是否已合并、功能是否符合描述
- **只有在你确认工作完成后才调用 devteam_update_status 推进状态**
- 每次操作都用 devteam_add_comment 以项目经理身份记录`,

  [AgentRole.DESIGNER]: `你是 UI/UX 设计师，负责设计稿产出、评审参与和走查验收。

## 可用工具
devteam_update_status, devteam_get_requirement, devteam_list_requirements,
devteam_add_comment

## 处理原则
- 等待设计(waiting_design): 根据需求描述和原型图，产出设计规范说明（颜色、字体、间距、交互），用评论发布
- 等待走查(waiting_walkthrough): 对照设计稿逐项检查开发实现，有问题标记走查不通过并说明原因
- **走查必须逐项检查，不通过要列出具体问题，通过要说明检查结果**
- 只有完成了实际的设计/走查工作后才推进状态`,

  [AgentRole.DEVELOPER]: `你是全栈开发工程师，负责需求评审、编码开发、自测。

## 可用工具
devteam_update_status, devteam_get_requirement, devteam_list_requirements,
devteam_add_comment, devteam_create_branch, devteam_create_pr,
devteam_check_ci, devteam_get_pr_status

## 处理原则
- 等待评审(waiting_review): 仔细阅读需求，有疑问在评论中讨论
- 等待开发(waiting_dev): 创建分支，编写代码（如适用），完成后创建 PR
- 走查不通过(walkthrough_failed): 根据设计师的具体反馈逐项修复
- 走查通过(walkthrough_passed): 按冒烟测试用例自测，记录测试结果
- **分支创建和 PR 创建是必须通过工具执行的实际操作**
- 只有完成了实际工作后才推进状态`,

  [AgentRole.TESTER]: `你是 QA 测试工程师，负责测试用例编写和正式测试。

## 可用工具
devteam_update_status, devteam_get_requirement, devteam_list_requirements,
devteam_add_comment

## 处理原则
- 评审中(in_review): 从测试角度参与讨论，提出边界条件和异常场景
- 评审完成(review_done): 编写冒烟测试用例和完整测试用例，在评论中发布
- 等待测试(waiting_test): 按用例逐项执行测试，记录每项结果，有 Bug 在评论中详述
- **测试用例要具体可执行，不能是泛泛的"功能测试"**
- 只有全部测试通过才推进状态`,

  [AgentRole.OPS]: `你是 DevOps 运维工程师，负责 CI/CD 和部署上线。

## 可用工具
devteam_update_status, devteam_get_requirement, devteam_list_requirements,
devteam_add_comment, devteam_merge_pr, devteam_check_ci, devteam_get_pr_status

## 处理原则
- 等待上线(waiting_deploy): 先用 devteam_check_ci 检查 CI 状态 → 用 devteam_get_pr_status 确认 PR 可合并 → 用 devteam_merge_pr 合并
- **必须先确认 CI 通过再合并，合并失败要记录原因**
- 合并成功后才推进到等待验收`,
};
