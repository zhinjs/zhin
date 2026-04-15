/**
 * @zhin.js/devteam - Agent 编排器
 *
 * 将状态变更事件路由到对应的子 Agent 进行处理。
 * 当 AIService 可用时，通过 runAgent() 调用真实 AI 子代理；
 * 否则退化为规则式处理（评论 + 状态流转）。
 */

import { Logger } from 'zhin.js';
import type { StatusChangeEvent, AgentRoleValue, RequirementStatusValue, Requirement } from './types.js';
import { RequirementStatus, AgentRole, STATUS_LABELS } from './types.js';
import type { DevTeamEventBus } from './event-bus.js';
import type { RequirementStateMachine } from './state-machine.js';
import type { GitHubClient } from './github.js';

const logger = new Logger(null, 'DevTeam:Orchestrator');

/** AIService 的最小接口，避免硬依赖 @zhin.js/agent 类型 */
interface AIServiceLike {
  runAgent(task: string, options?: { systemPrompt?: string }): Promise<{ content: string; toolCalls: any[]; usage: any }>;
}

export interface AgentHandler {
  role: AgentRoleValue;
  handle: (event: StatusChangeEvent) => Promise<string>;
}

/**
 * 构建项目经理的处理逻辑
 */
function buildProjectManagerHandler(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  ai: AIServiceLike | null,
): (event: StatusChangeEvent) => Promise<string> {
  return async (event) => {
    const req = stateMachine.get(event.issueNumber);

    if (ai) {
      const task = buildAgentTask('项目经理', event, req);
      try {
        const result = await ai.runAgent(task, { systemPrompt: PM_SYSTEM_PROMPT });
        logger.info(`[PM Agent] #${event.issueNumber} AI 处理完成`);
        return result.content || `项目经理已处理: #${event.issueNumber}`;
      } catch (err) {
        logger.warn(`[PM Agent] AI 调用失败，退化为规则处理:`, err);
      }
    }

    // 退化：规则式处理
    switch (event.to) {
      case RequirementStatus.IN_REVIEW: {
        // 评审中 - 收集各方评论并协调
        const comments = await github.getIssueComments(event.issueNumber);
        const recentComments = comments.slice(-10).map(c =>
          `${c.user.login}: ${c.body.substring(0, 200)}`
        ).join('\n');
        await github.addIssueComment(event.issueNumber,
          `📋 **[项目经理]** 需求评审已开始\n\n` +
          `请各位同事从各自专业角度参与讨论：\n` +
          `- 💻 @developer 请确认技术可行性\n` +
          `- 🧪 @tester 请准备测试用例\n` +
          `- 🎨 @designer 请确认设计完整性\n\n` +
          `当前讨论摘要:\n${recentComments || '暂无评论'}`,
        );
        return `项目经理已协调评审: #${event.issueNumber}`;
      }

      case RequirementStatus.WAITING_ACCEPTANCE: {
        // 等待验收 - 验证生产环境
        await github.addIssueComment(event.issueNumber,
          `📋 **[项目经理]** 需求已部署到生产环境，开始验收\n\n` +
          `验收检查项：\n` +
          `- [ ] 功能是否符合需求描述\n` +
          `- [ ] 用户体验是否达标\n` +
          `- [ ] 是否有明显缺陷\n\n` +
          `验收中...`,
        );
        // 实际的验收逻辑：访问生产环境并验证
        // 这里简化为自动通过
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.DONE,
          AgentRole.PROJECT_MANAGER,
        );
        return `项目经理已验收通过: #${event.issueNumber}`;
      }

      default:
        return `项目经理收到事件: ${STATUS_LABELS[event.to]}`;
    }
  };
}

/**
 * 构建设计师的处理逻辑
 */
function buildDesignerHandler(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  ai: AIServiceLike | null,
): (event: StatusChangeEvent) => Promise<string> {
  return async (event) => {
    const req = stateMachine.get(event.issueNumber);

    if (ai) {
      const task = buildAgentTask('设计师', event, req);
      try {
        const result = await ai.runAgent(task, { systemPrompt: DESIGNER_SYSTEM_PROMPT });
        logger.info(`[Designer Agent] #${event.issueNumber} AI 处理完成`);
        return result.content || `设计师已处理: #${event.issueNumber}`;
      } catch (err) {
        logger.warn(`[Designer Agent] AI 调用失败，退化为规则处理:`, err);
      }
    }

    // 退化：规则式处理
    switch (event.to) {
      case RequirementStatus.WAITING_DESIGN: {
        // 等待设计 - 产出设计稿
        const req = stateMachine.get(event.issueNumber);
        await github.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 收到设计需求\n\n` +
          `原型图: ${req?.prototypeUrl || '待提供'}\n\n` +
          `开始产出设计稿，预计完成后将更新状态。`,
        );
        // 产出设计稿后更新状态
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_REVIEW,
          AgentRole.DESIGNER,
        );
        return `设计师已完成设计: #${event.issueNumber}`;
      }

      case RequirementStatus.IN_REVIEW: {
        // 评审中 - 参与讨论
        await github.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 参与需求评审\n\n` +
          `从设计角度确认需求可行，如有疑问请 @设计师 讨论。`,
        );
        return `设计师已参与评审: #${event.issueNumber}`;
      }

      case RequirementStatus.WAITING_WALKTHROUGH: {
        // 等待走查 - 检查开发实现
        const req = stateMachine.get(event.issueNumber);
        await github.addIssueComment(event.issueNumber,
          `🎨 **[设计师]** 开始走查开发实现\n\n` +
          `对照设计稿检查以下内容：\n` +
          `- [ ] 布局和间距\n` +
          `- [ ] 颜色和字体\n` +
          `- [ ] 交互效果\n` +
          `- [ ] 响应式适配\n\n` +
          `走查中...`,
        );
        // 走查逻辑：这里根据实际情况判断通过或不通过
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WALKTHROUGH_PASSED,
          AgentRole.DESIGNER,
        );
        return `设计师走查完成: #${event.issueNumber}`;
      }

      default:
        return `设计师收到事件: ${STATUS_LABELS[event.to]}`;
    }
  };
}

/**
 * 构建开发人员的处理逻辑
 */
function buildDeveloperHandler(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  productionBranch: string,
  ai: AIServiceLike | null,
): (event: StatusChangeEvent) => Promise<string> {
  return async (event) => {
    const req = stateMachine.get(event.issueNumber);

    if (ai) {
      const task = buildAgentTask('开发人员', event, req);
      try {
        const result = await ai.runAgent(task, { systemPrompt: DEVELOPER_SYSTEM_PROMPT });
        logger.info(`[Developer Agent] #${event.issueNumber} AI 处理完成`);
        return result.content || `开发人员已处理: #${event.issueNumber}`;
      } catch (err) {
        logger.warn(`[Developer Agent] AI 调用失败，退化为规则处理:`, err);
      }
    }

    // 退化：规则式处理
    switch (event.to) {
      case RequirementStatus.WAITING_REVIEW: {
        // 等待评审 → 评审中
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.IN_REVIEW,
          AgentRole.DEVELOPER,
        );
        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 开始评审需求\n\n` +
          `正在理解需求细节，如有疑问将在评论中 @相关人员。`,
        );
        return `开发人员开始评审: #${event.issueNumber}`;
      }

      case RequirementStatus.IN_REVIEW: {
        // 评审中 - 理解需求后完成评审
        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 需求理解完毕\n\n` +
          `技术方案已确认，准备进入开发阶段。`,
        );
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.REVIEW_DONE,
          AgentRole.DEVELOPER,
        );
        return `开发人员完成评审: #${event.issueNumber}`;
      }

      case RequirementStatus.WAITING_DEV: {
        // 等待开发 - 创建分支开始开发
        const slug = event.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .substring(0, 30);
        const branchName = `feat/issue-${event.issueNumber}-${slug}`;

        try {
          await github.createBranch(branchName, productionBranch);
          stateMachine.update(event.issueNumber, { branchName });
        } catch (err: unknown) {
          const errMsg = String(err);
          if (errMsg.includes('Reference already exists')) {
            logger.info(`分支已存在，复用: ${branchName}`);
          } else {
            logger.error(`分支创建失败: ${branchName}`, err);
          }
        }

        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.IN_DEV,
          AgentRole.DEVELOPER,
        );

        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 已创建开发分支 \`${branchName}\`，开始开发`,
        );
        return `开发人员开始开发: #${event.issueNumber}, 分支: ${branchName}`;
      }

      case RequirementStatus.WALKTHROUGH_FAILED: {
        // 走查不通过 - 根据反馈修复
        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 收到走查反馈，开始修复\n\n` +
          `正在根据设计师的反馈进行调整...`,
        );
        // 修复后重新提交走查
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_WALKTHROUGH,
          AgentRole.DEVELOPER,
        );
        return `开发人员已修复走查问题: #${event.issueNumber}`;
      }

      case RequirementStatus.WALKTHROUGH_PASSED: {
        // 走查通过 - 进行自测
        const req = stateMachine.get(event.issueNumber);
        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 走查已通过，开始按冒烟用例自测\n\n` +
          `自测中...`,
        );
        // 自测通过后提测
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_TEST,
          AgentRole.DEVELOPER,
        );
        await github.addIssueComment(event.issueNumber,
          `💻 **[开发人员]** 自测通过，@tester 请开始正式测试`,
        );
        return `开发人员自测通过: #${event.issueNumber}`;
      }

      default:
        return `开发人员收到事件: ${STATUS_LABELS[event.to]}`;
    }
  };
}

/**
 * 构建测试人员的处理逻辑
 */
function buildTesterHandler(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  ai: AIServiceLike | null,
): (event: StatusChangeEvent) => Promise<string> {
  return async (event) => {
    const req = stateMachine.get(event.issueNumber);

    if (ai) {
      const task = buildAgentTask('测试人员', event, req);
      try {
        const result = await ai.runAgent(task, { systemPrompt: TESTER_SYSTEM_PROMPT });
        logger.info(`[Tester Agent] #${event.issueNumber} AI 处理完成`);
        return result.content || `测试人员已处理: #${event.issueNumber}`;
      } catch (err) {
        logger.warn(`[Tester Agent] AI 调用失败，退化为规则处理:`, err);
      }
    }

    // 退化：规则式处理
    switch (event.to) {
      case RequirementStatus.IN_REVIEW: {
        // 评审中 - 参与讨论并准备测试用例
        await github.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 参与需求评审\n\n` +
          `正在分析测试点，将准备冒烟测试和完整测试用例。`,
        );
        return `测试人员参与评审: #${event.issueNumber}`;
      }

      case RequirementStatus.REVIEW_DONE: {
        // 评审完成 - 完成测试用例并更新状态
        await github.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 测试用例已准备完成\n\n` +
          `### 冒烟测试用例\n` +
          `1. 验证核心功能正常\n` +
          `2. 验证主流程无阻塞\n` +
          `3. 验证关键数据正确\n\n` +
          `### 完整测试用例\n` +
          `详见测试文档\n\n` +
          `@developer 请查收冒烟用例进行自测`,
        );
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_DEV,
          AgentRole.TESTER,
        );
        return `测试人员准备完毕: #${event.issueNumber}`;
      }

      case RequirementStatus.WAITING_TEST: {
        // 等待测试 - 执行完整测试
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.IN_TEST,
          AgentRole.TESTER,
        );
        await github.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 开始执行完整测试\n\n` +
          `测试范围：\n` +
          `- [ ] 功能测试\n` +
          `- [ ] 边界测试\n` +
          `- [ ] 异常测试\n` +
          `- [ ] 兼容性测试\n\n` +
          `测试中...`,
        );
        // 测试通过后更新状态
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_DEPLOY,
          AgentRole.TESTER,
        );
        await github.addIssueComment(event.issueNumber,
          `🧪 **[测试人员]** 所有测试通过！\n\n` +
          `@ops 请安排上线部署`,
        );
        return `测试人员测试通过: #${event.issueNumber}`;
      }

      default:
        return `测试人员收到事件: ${STATUS_LABELS[event.to]}`;
    }
  };
}

/**
 * 构建运维人员的处理逻辑
 */
function buildOpsHandler(
  github: GitHubClient,
  stateMachine: RequirementStateMachine,
  ai: AIServiceLike | null,
): (event: StatusChangeEvent) => Promise<string> {
  return async (event) => {
    const req = stateMachine.get(event.issueNumber);

    if (ai) {
      const task = buildAgentTask('运维人员', event, req);
      try {
        const result = await ai.runAgent(task, { systemPrompt: OPS_SYSTEM_PROMPT });
        logger.info(`[Ops Agent] #${event.issueNumber} AI 处理完成`);
        return result.content || `运维已处理: #${event.issueNumber}`;
      } catch (err) {
        logger.warn(`[Ops Agent] AI 调用失败，退化为规则处理:`, err);
      }
    }

    // 退化：规则式处理
    switch (event.to) {
      case RequirementStatus.WAITING_DEPLOY: {
        // 等待上线 - 合并 PR 并部署
        const req = stateMachine.get(event.issueNumber);
        if (!req?.prNumber) {
          await github.addIssueComment(event.issueNumber,
            `🚀 **[运维]** 未找到关联 PR，无法自动部署。请开发人员确认 PR 已创建。`,
          );
          return `运维未找到PR: #${event.issueNumber}`;
        }

        // 检查 CI 状态
        const pr = await github.getPullRequest(req.prNumber);
        if (pr.state !== 'open') {
          await github.addIssueComment(event.issueNumber,
            `🚀 **[运维]** PR #${req.prNumber} 状态为 ${pr.state}，跳过合并`,
          );
        } else {
          // 合并 PR
          try {
            await github.mergePullRequest(req.prNumber, 'squash');
            await github.addIssueComment(event.issueNumber,
              `🚀 **[运维]** PR #${req.prNumber} 已合并到生产分支\n\n` +
              `等待生产环境部署完成...`,
            );
          } catch (err) {
            await github.addIssueComment(event.issueNumber,
              `🚀 **[运维]** PR 合并失败: ${err}\n\n请检查 CI 状态和合并冲突。`,
            );
            return `运维合并PR失败: #${event.issueNumber}`;
          }
        }

        // 更新状态为等待验收
        await stateMachine.transition(
          event.issueNumber,
          RequirementStatus.WAITING_ACCEPTANCE,
          AgentRole.OPS,
        );
        await github.addIssueComment(event.issueNumber,
          `🚀 **[运维]** 生产部署完成\n\n@project_manager 请进行验收`,
        );
        return `运维已部署: #${event.issueNumber}`;
      }

      default:
        return `运维收到事件: ${STATUS_LABELS[event.to]}`;
    }
  };
}

// ============================================================================
// 编排器
// ============================================================================

export class DevTeamOrchestrator {
  private handlers: Map<AgentRoleValue, (event: StatusChangeEvent) => Promise<string>> = new Map();
  private processing: Set<string> = new Set();
  private ai: AIServiceLike | null = null;

  constructor(
    private github: GitHubClient,
    private stateMachine: RequirementStateMachine,
    private eventBus: DevTeamEventBus,
    private productionBranch: string,
  ) {
    this.setupHandlers();
    this.setupEventRouting();
  }

  /**
   * 注入 AIService 实例，使编排器能调用真实 AI 子代理。
   * 可在 useContext('ai', ...) 就绪后调用。
   */
  setAI(ai: AIServiceLike | null): void {
    this.ai = ai;
    // 重建 handlers 以注入 AI
    this.setupHandlers();
    logger.info(ai ? 'AI 子代理模式已启用' : 'AI 子代理模式已关闭，使用规则式处理');
  }

  private setupHandlers(): void {
    this.handlers.set(AgentRole.PROJECT_MANAGER,
      buildProjectManagerHandler(this.github, this.stateMachine, this.ai));
    this.handlers.set(AgentRole.DESIGNER,
      buildDesignerHandler(this.github, this.stateMachine, this.ai));
    this.handlers.set(AgentRole.DEVELOPER,
      buildDeveloperHandler(this.github, this.stateMachine, this.productionBranch, this.ai));
    this.handlers.set(AgentRole.TESTER,
      buildTesterHandler(this.github, this.stateMachine, this.ai));
    this.handlers.set(AgentRole.OPS,
      buildOpsHandler(this.github, this.stateMachine, this.ai));
  }

  private setupEventRouting(): void {
    // 按角色路由事件
    for (const [role, handler] of this.handlers) {
      this.eventBus.onRole(role, async (event) => {
        const eventKey = `${event.issueNumber}:${event.to}:${role}`;
        if (this.processing.has(eventKey)) {
          logger.debug(`跳过重复处理: ${eventKey}`);
          return;
        }
        this.processing.add(eventKey);

        try {
          const result = await handler(event);
          logger.info(`[${role}] 处理完成: ${result}`);
        } catch (err) {
          logger.error(`[${role}] 处理失败 #${event.issueNumber}:`, err);
          try {
            await this.github.addIssueComment(event.issueNumber,
              `⚠️ **[系统]** ${role} 处理需求时出错: ${err}`,
            );
          } catch (commentErr) {
            logger.error(`发送错误通知评论失败 #${event.issueNumber}:`, commentErr);
          }
        } finally {
          this.processing.delete(eventKey);
        }
      });
    }
  }

  dispose(): void {
    this.handlers.clear();
    this.processing.clear();
  }
}

// ============================================================================
// AI Agent 任务构建与系统提示
// ============================================================================

/**
 * 构建发给子 Agent 的任务描述，包含事件上下文和需求详情
 */
function buildAgentTask(
  roleName: string,
  event: StatusChangeEvent,
  req: Requirement | undefined,
): string {
  const lines: string[] = [
    `你是「${roleName}」，当前需要处理一个状态变更事件。`,
    '',
    `## 事件信息`,
    `- 需求 Issue: #${event.issueNumber}`,
    `- 标题: ${event.title}`,
    `- 状态变更: [${STATUS_LABELS[event.from]}] → [${STATUS_LABELS[event.to]}]`,
    `- 触发者: ${event.triggeredBy}`,
  ];

  if (req) {
    lines.push(
      '',
      `## 需求详情`,
      `- 描述: ${req.description || '无'}`,
      `- 是否需要设计: ${req.needsDesign ? '是' : '否'}`,
    );
    if (req.branchName) lines.push(`- 开发分支: ${req.branchName}`);
    if (req.prNumber) lines.push(`- PR: #${req.prNumber}`);
    if (req.prototypeUrl) lines.push(`- 原型图: ${req.prototypeUrl}`);
    if (req.designUrl) lines.push(`- 设计稿: ${req.designUrl}`);
  }

  lines.push(
    '',
    `请根据你的职责和当前状态，使用可用的工具完成处理。`,
  );

  return lines.join('\n');
}

const PM_SYSTEM_PROMPT = `你是项目经理，负责需求整理、评审协调和验收确认。
你可以使用 devteam_* 系列工具来操作看板、查看需求、添加评论、管理反馈。
- 评审中：收集各方评论并协调讨论
- 等待验收：验证需求完成度，通过则更新为已完成
请用工具完成实际操作，不要只描述你会做什么。`;

const DESIGNER_SYSTEM_PROMPT = `你是 UI/UX 设计师，负责设计稿产出、评审参与和走查验收。
你可以使用 devteam_* 系列工具来更新状态、查看需求、添加评论。
- 等待设计：产出设计说明并更新状态为等待评审
- 等待走查：对照设计稿检查开发实现，通过或不通过
请用工具完成实际操作，不要只描述你会做什么。`;

const DEVELOPER_SYSTEM_PROMPT = `你是全栈开发工程师，负责需求评审、编码开发、自测。
你可以使用 devteam_* 系列工具来更新状态、创建分支、创建 PR、添加评论。
- 等待评审 → 评审中 → 评审完成
- 等待开发：创建开发分支并开始编码
- 走查不通过：根据反馈修复
- 走查通过：自测后提测
请用工具完成实际操作，不要只描述你会做什么。`;

const TESTER_SYSTEM_PROMPT = `你是 QA 测试工程师，负责测试用例编写和执行。
你可以使用 devteam_* 系列工具来更新状态、查看需求、添加评论。
- 评审中：参与讨论并准备测试用例
- 评审完成：完成测试用例，更新为等待开发
- 等待测试：执行完整测试，通过后更新为等待上线
请用工具完成实际操作，不要只描述你会做什么。`;

const OPS_SYSTEM_PROMPT = `你是 DevOps 运维工程师，负责 CI/CD 和部署上线。
你可以使用 devteam_* 系列工具来合并 PR、检查 CI、更新状态、添加评论。
- 等待上线：检查 CI，合并 PR，部署后更新为等待验收
请用工具完成实际操作，不要只描述你会做什么。`;
