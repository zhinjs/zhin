/**
 * @zhin.js/devteam - 类型定义与常量
 *
 * 定义多Agent协同开发的工作流状态、角色、事件等核心类型
 */

// ============================================================================
// 需求状态（对应 GitHub Project 看板列）
// ============================================================================

export const RequirementStatus = {
  /** 待整理 - 用户反馈收集后的原始状态 */
  PENDING_TRIAGE: 'pending_triage',
  /** 等待设计 - 需要设计师介入 */
  WAITING_DESIGN: 'waiting_design',
  /** 等待评审 - 需求已就绪，等待团队评审 */
  WAITING_REVIEW: 'waiting_review',
  /** 评审中 - 团队正在讨论需求细节 */
  IN_REVIEW: 'in_review',
  /** 评审完成 - 开发人员已完成需求理解 */
  REVIEW_DONE: 'review_done',
  /** 等待开发 - 测试用例已准备，等待开发 */
  WAITING_DEV: 'waiting_dev',
  /** 开发中 - 开发人员正在编码 */
  IN_DEV: 'in_dev',
  /** 等待走查 - 开发完成，等待设计走查 */
  WAITING_WALKTHROUGH: 'waiting_walkthrough',
  /** 走查通过 */
  WALKTHROUGH_PASSED: 'walkthrough_passed',
  /** 走查不通过 */
  WALKTHROUGH_FAILED: 'walkthrough_failed',
  /** 等待测试 - 自测通过，等待测试人员 */
  WAITING_TEST: 'waiting_test',
  /** 测试中 */
  IN_TEST: 'in_test',
  /** 等待上线 - 测试通过 */
  WAITING_DEPLOY: 'waiting_deploy',
  /** 等待验收 - 已部署到生产 */
  WAITING_ACCEPTANCE: 'waiting_acceptance',
  /** 已完成 */
  DONE: 'done',
  /** 已关闭（不做） */
  CLOSED: 'closed',
} as const;

export type RequirementStatusValue = typeof RequirementStatus[keyof typeof RequirementStatus];

// ============================================================================
// Agent 角色
// ============================================================================

export const AgentRole = {
  DIRECTOR: 'director',
  PROJECT_MANAGER: 'project_manager',
  DESIGNER: 'designer',
  DEVELOPER: 'developer',
  TESTER: 'tester',
  OPS: 'ops',
} as const;

export type AgentRoleValue = typeof AgentRole[keyof typeof AgentRole];

// ============================================================================
// 状态变更事件
// ============================================================================

export interface StatusChangeEvent {
  /** 需求 issue 编号 */
  issueNumber: number;
  /** 需求标题 */
  title: string;
  /** 旧状态 */
  from: RequirementStatusValue;
  /** 新状态 */
  to: RequirementStatusValue;
  /** 触发者角色 */
  triggeredBy: AgentRoleValue;
  /** 时间戳 */
  timestamp: number;
  /** 附加数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 需求数据
// ============================================================================

export interface Requirement {
  /** GitHub issue 编号 */
  issueNumber: number;
  /** 标题 */
  title: string;
  /** 详细描述 */
  description: string;
  /** 当前状态 */
  status: RequirementStatusValue;
  /** 是否需要设计阶段 */
  needsDesign: boolean;
  /** 原型图链接（如需设计） */
  prototypeUrl?: string;
  /** 设计稿链接 */
  designUrl?: string;
  /** 关联 PR 编号 */
  prNumber?: number;
  /** 开发分支名 */
  branchName?: string;
  /** 冒烟测试用例 issue 编号 */
  smokeTestIssue?: number;
  /** 完整测试用例 issue 编号 */
  fullTestIssue?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ============================================================================
// 用户反馈
// ============================================================================

export interface UserFeedback {
  /** 反馈来源用户 */
  userId: string;
  /** 平台 */
  platform: string;
  /** 反馈内容 */
  content: string;
  /** 收集时间 */
  collectedAt: number;
  /** 是否已处理 */
  processed: boolean;
  /** 归属需求编号 */
  requirementIssue?: number;
}

// ============================================================================
// GitHub 配置
// ============================================================================

export interface DevTeamConfig {
  /** GitHub Personal Access Token */
  githubToken: string;
  /** 仓库 owner */
  owner: string;
  /** 仓库名 */
  repo: string;
  /** GitHub Project 编号 */
  projectNumber: number;
  /** 生产分支名 */
  productionBranch: string;
  /** 测试环境 URL */
  testEnvUrl?: string;
  /** 生产环境 URL */
  productionUrl?: string;
  /** 每日需求整理时间 (cron 表达式) */
  triageCron: string;
  /** 需求状态轮询间隔（分钟） */
  pollIntervalMinutes: number;
}

export const DEFAULT_CONFIG: DevTeamConfig = {
  githubToken: '',
  owner: '',
  repo: '',
  projectNumber: 1,
  productionBranch: 'main',
  triageCron: '0 9 * * 1-5',
  pollIntervalMinutes: 5,
};

// ============================================================================
// 状态流转映射（合法转换）
// ============================================================================

export const VALID_TRANSITIONS: Record<RequirementStatusValue, RequirementStatusValue[]> = {
  [RequirementStatus.PENDING_TRIAGE]: [
    RequirementStatus.WAITING_DESIGN,
    RequirementStatus.WAITING_REVIEW,
    RequirementStatus.CLOSED,
  ],
  [RequirementStatus.WAITING_DESIGN]: [
    RequirementStatus.WAITING_REVIEW,
    RequirementStatus.CLOSED,
  ],
  [RequirementStatus.WAITING_REVIEW]: [
    RequirementStatus.IN_REVIEW,
    RequirementStatus.CLOSED,
  ],
  [RequirementStatus.IN_REVIEW]: [
    RequirementStatus.REVIEW_DONE,
  ],
  [RequirementStatus.REVIEW_DONE]: [
    RequirementStatus.WAITING_DEV,
  ],
  [RequirementStatus.WAITING_DEV]: [
    RequirementStatus.IN_DEV,
  ],
  [RequirementStatus.IN_DEV]: [
    RequirementStatus.WAITING_WALKTHROUGH,
  ],
  [RequirementStatus.WAITING_WALKTHROUGH]: [
    RequirementStatus.WALKTHROUGH_PASSED,
    RequirementStatus.WALKTHROUGH_FAILED,
  ],
  [RequirementStatus.WALKTHROUGH_PASSED]: [
    RequirementStatus.WAITING_TEST,
  ],
  [RequirementStatus.WALKTHROUGH_FAILED]: [
    RequirementStatus.WAITING_WALKTHROUGH,
  ],
  [RequirementStatus.WAITING_TEST]: [
    RequirementStatus.IN_TEST,
  ],
  [RequirementStatus.IN_TEST]: [
    RequirementStatus.WAITING_DEPLOY,
    RequirementStatus.WAITING_TEST,
  ],
  [RequirementStatus.WAITING_DEPLOY]: [
    RequirementStatus.WAITING_ACCEPTANCE,
  ],
  [RequirementStatus.WAITING_ACCEPTANCE]: [
    RequirementStatus.DONE,
    RequirementStatus.WAITING_DEV,
  ],
  [RequirementStatus.DONE]: [],
  [RequirementStatus.CLOSED]: [],
};

// ============================================================================
// 状态到负责角色映射
// ============================================================================

export const STATUS_OWNER: Record<RequirementStatusValue, AgentRoleValue> = {
  [RequirementStatus.PENDING_TRIAGE]: AgentRole.PROJECT_MANAGER,
  [RequirementStatus.WAITING_DESIGN]: AgentRole.DESIGNER,
  [RequirementStatus.WAITING_REVIEW]: AgentRole.DEVELOPER,
  [RequirementStatus.IN_REVIEW]: AgentRole.DEVELOPER,
  [RequirementStatus.REVIEW_DONE]: AgentRole.TESTER,
  [RequirementStatus.WAITING_DEV]: AgentRole.DEVELOPER,
  [RequirementStatus.IN_DEV]: AgentRole.DEVELOPER,
  [RequirementStatus.WAITING_WALKTHROUGH]: AgentRole.DESIGNER,
  [RequirementStatus.WALKTHROUGH_PASSED]: AgentRole.DEVELOPER,
  [RequirementStatus.WALKTHROUGH_FAILED]: AgentRole.DEVELOPER,
  [RequirementStatus.WAITING_TEST]: AgentRole.TESTER,
  [RequirementStatus.IN_TEST]: AgentRole.TESTER,
  [RequirementStatus.WAITING_DEPLOY]: AgentRole.OPS,
  [RequirementStatus.WAITING_ACCEPTANCE]: AgentRole.PROJECT_MANAGER,
  [RequirementStatus.DONE]: AgentRole.PROJECT_MANAGER,
  [RequirementStatus.CLOSED]: AgentRole.PROJECT_MANAGER,
};

// ============================================================================
// 状态显示名
// ============================================================================

export const STATUS_LABELS: Record<RequirementStatusValue, string> = {
  [RequirementStatus.PENDING_TRIAGE]: '待整理',
  [RequirementStatus.WAITING_DESIGN]: '等待设计',
  [RequirementStatus.WAITING_REVIEW]: '等待评审',
  [RequirementStatus.IN_REVIEW]: '评审中',
  [RequirementStatus.REVIEW_DONE]: '评审完成',
  [RequirementStatus.WAITING_DEV]: '等待开发',
  [RequirementStatus.IN_DEV]: '开发中',
  [RequirementStatus.WAITING_WALKTHROUGH]: '等待走查',
  [RequirementStatus.WALKTHROUGH_PASSED]: '走查通过',
  [RequirementStatus.WALKTHROUGH_FAILED]: '走查不通过',
  [RequirementStatus.WAITING_TEST]: '等待测试',
  [RequirementStatus.IN_TEST]: '测试中',
  [RequirementStatus.WAITING_DEPLOY]: '等待上线',
  [RequirementStatus.WAITING_ACCEPTANCE]: '等待验收',
  [RequirementStatus.DONE]: '已完成',
  [RequirementStatus.CLOSED]: '已关闭',
};
