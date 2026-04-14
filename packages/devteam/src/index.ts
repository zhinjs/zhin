/**
 * @zhin.js/devteam
 *
 * 多Agent协同开发插件
 *
 * 主Agent（项目总监）管理5个子Agent：
 *   - 项目经理：需求整理、评审协调、验收确认
 *   - 设计师：设计稿产出、走查验收
 *   - 开发人员：编码开发、Bug修复
 *   - 测试人员：测试用例编写、完整测试
 *   - 运维人员：CI/CD、部署上线
 *
 * 基于 GitHub Project 看板驱动需求状态流转
 */

import { usePlugin, Cron } from 'zhin.js';
import { GitHubClient } from './github.js';
import { DevTeamEventBus } from './event-bus.js';
import { RequirementStateMachine } from './state-machine.js';
import { DevTeamOrchestrator } from './orchestrator.js';
import { createBoardTools, createDevTools, createFeedbackTools } from './tools/index.js';
import type { DevTeamConfig, UserFeedback, Requirement, RequirementStatusValue } from './types.js';
import { DEFAULT_CONFIG, RequirementStatus, STATUS_LABELS } from './types.js';

const plugin = usePlugin();
const { addTool, addCron, useContext, logger, root } = plugin;

// ─── 配置 ────────────────────────────────────────────────────────────────────

const configService = root.inject('config');
const appConfig = configService?.getData?.('zhin.config.yml') || {};
const config: DevTeamConfig = {
  ...DEFAULT_CONFIG,
  ...(appConfig as Record<string, unknown>).devteam as Partial<DevTeamConfig> | undefined,
};

if (!config.owner || !config.repo) {
  logger.warn('DevTeam 插件缺少必要配置 (owner, repo)，请在配置文件中设置 devteam 配置项');
}

// ─── 核心组件初始化 ──────────────────────────────────────────────────────────

const github = new GitHubClient(config);

// ─── 复用 GitHub 适配器（可选） ──────────────────────────────────────────────
// 当 @zhin.js/adapter-github 已启用时，通过其 GhClient 代理 API 调用，
// 共享适配器的认证（gh CLI / GitHub App / OAuth），无需单独配置 githubToken。

// Note: 'github' Context is registered by @zhin.js/adapter-github when loaded.
// We use 'as any' to avoid a hard type dependency on the adapter package.
useContext('github' as any, (adapter: any) => {
  const ghClient = adapter?.getAPI?.();
  if (ghClient && typeof ghClient.request === 'function') {
    github.setDelegate(ghClient);
  }
  return () => {
    github.setDelegate(null);
  };
});

const eventBus = new DevTeamEventBus();
const stateMachine = new RequirementStateMachine(github, eventBus);

// 用户反馈数据存储
const feedbacks: UserFeedback[] = [];

// ─── 编排器（连接事件总线与各 Agent 处理器） ─────────────────────────────────

const orchestrator = new DevTeamOrchestrator(
  github,
  stateMachine,
  eventBus,
  config.productionBranch,
);

// ─── 注册 AI 工具 ────────────────────────────────────────────────────────────

// 看板操作工具
for (const tool of createBoardTools(github, stateMachine)) {
  addTool(tool);
}

// 开发相关工具
for (const tool of createDevTools(github, stateMachine, config.productionBranch)) {
  addTool(tool);
}

// 反馈管理工具
for (const tool of createFeedbackTools(feedbacks)) {
  addTool(tool);
}

// ─── 定时任务 ────────────────────────────────────────────────────────────────

// 项目经理每日需求整理
addCron(new Cron(config.triageCron, async () => {
  logger.info('开始每日需求整理...');
  const unprocessed = feedbacks.filter(f => !f.processed);
  if (unprocessed.length === 0) {
    logger.info('没有未处理的用户反馈');
    return;
  }
  logger.info(`发现 ${unprocessed.length} 条未处理反馈，等待项目经理处理`);
  // 项目经理 Agent 会通过 devteam_list_feedback 工具查看并处理
}));

// 定期同步看板状态
addCron(new Cron(`*/${config.pollIntervalMinutes} * * * *`, async () => {
  try {
    await syncProjectBoard();
  } catch (err) {
    logger.error('同步看板状态失败:', err);
  }
}));

// ─── 看板同步 ────────────────────────────────────────────────────────────────

async function syncProjectBoard(): Promise<void> {
  if (!github.isReady()) return;

  const items = await github.getProjectItems();
  logger.debug(`同步看板: 获取到 ${items.length} 个条目`);

  for (const item of items) {
    const existing = stateMachine.get(item.issueNumber);
    if (!existing) {
      // 新发现的看板项，注册到状态机
      const statusValue = findStatusValue(item.status);
      if (statusValue) {
        const req: Requirement = {
          issueNumber: item.issueNumber,
          title: item.title,
          description: item.body,
          status: statusValue,
          needsDesign: item.labels.includes('needs-design'),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        stateMachine.register(req, item.itemId);
      }
    }
  }
}

/**
 * 从看板显示的状态名反查内部状态值
 */
function findStatusValue(statusLabel: string): RequirementStatusValue | undefined {
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    if (label === statusLabel) {
      return value as RequirementStatusValue;
    }
  }
  return undefined;
}

// ─── 提供 Context 给主 Agent ─────────────────────────────────────────────────

plugin.provide({
  name: 'devteam',
  description: '多Agent协同开发服务',
  value: {
    github,
    eventBus,
    stateMachine,
    feedbacks,

    /** 添加用户反馈（主 Agent 调用） */
    addFeedback(feedback: Omit<UserFeedback, 'processed' | 'collectedAt'>): void {
      feedbacks.push({
        ...feedback,
        processed: false,
        collectedAt: Date.now(),
      });
      logger.info(`收到用户反馈: ${feedback.content.substring(0, 50)}...`);
    },

    /** 获取统计信息 */
    getStats() {
      const all = stateMachine.getAll();
      const statusCounts: Record<string, number> = {};
      for (const req of all) {
        statusCounts[STATUS_LABELS[req.status]] = (statusCounts[STATUS_LABELS[req.status]] || 0) + 1;
      }
      return {
        totalRequirements: all.length,
        totalFeedbacks: feedbacks.length,
        unprocessedFeedbacks: feedbacks.filter(f => !f.processed).length,
        statusDistribution: statusCounts,
      };
    },
  },
});

// ─── 类型扩展 ────────────────────────────────────────────────────────────────

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      devteam: {
        github: GitHubClient;
        eventBus: DevTeamEventBus;
        stateMachine: RequirementStateMachine;
        feedbacks: UserFeedback[];
        addFeedback(feedback: Omit<UserFeedback, 'processed' | 'collectedAt'>): void;
        getStats(): {
          totalRequirements: number;
          totalFeedbacks: number;
          unprocessedFeedbacks: number;
          statusDistribution: Record<string, number>;
        };
      };
    }
  }
}

export default plugin;
