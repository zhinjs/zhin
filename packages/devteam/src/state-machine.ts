/**
 * @zhin.js/devteam - 状态机
 *
 * 管理需求的状态流转，确保合法性并触发事件
 */

import { Logger } from 'zhin.js';
import type {
  Requirement,
  RequirementStatusValue,
  AgentRoleValue,
  StatusChangeEvent,
} from './types.js';
import {
  VALID_TRANSITIONS,
  STATUS_LABELS,
} from './types.js';
import type { DevTeamEventBus } from './event-bus.js';
import type { GitHubClient } from './github.js';

const logger = new Logger(null, 'DevTeam:StateMachine');

export class RequirementStateMachine {
  /** 需求缓存 (issueNumber → Requirement) */
  private requirements: Map<number, Requirement> = new Map();
  /** issue → Project item ID 映射 */
  private itemIds: Map<number, string> = new Map();

  constructor(
    private github: GitHubClient,
    private eventBus: DevTeamEventBus,
  ) {}

  /**
   * 注册一个需求到状态机
   */
  register(req: Requirement, itemId: string): void {
    this.requirements.set(req.issueNumber, req);
    this.itemIds.set(req.issueNumber, itemId);
    logger.debug(`注册需求 #${req.issueNumber}: ${req.title}`);
  }

  /**
   * 获取需求
   */
  get(issueNumber: number): Requirement | undefined {
    return this.requirements.get(issueNumber);
  }

  /**
   * 获取所有需求
   */
  getAll(): Requirement[] {
    return Array.from(this.requirements.values());
  }

  /**
   * 获取某状态下的所有需求
   */
  getByStatus(status: RequirementStatusValue): Requirement[] {
    return this.getAll().filter(r => r.status === status);
  }

  /**
   * 执行状态变更
   */
  async transition(
    issueNumber: number,
    newStatus: RequirementStatusValue,
    triggeredBy: AgentRoleValue,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const req = this.requirements.get(issueNumber);
    if (!req) {
      logger.warn(`需求 #${issueNumber} 未注册`);
      return false;
    }

    const oldStatus = req.status;

    // 验证转换合法性
    const validTargets = VALID_TRANSITIONS[oldStatus];
    if (!validTargets?.includes(newStatus)) {
      logger.warn(
        `非法状态转换: #${issueNumber} [${STATUS_LABELS[oldStatus]}] → [${STATUS_LABELS[newStatus]}]`
      );
      return false;
    }

    // 更新本地状态
    req.status = newStatus;
    req.updatedAt = Date.now();

    // 更新 GitHub Project 看板
    const itemId = this.itemIds.get(issueNumber);
    if (itemId) {
      try {
        await this.github.updateProjectItemStatus(
          itemId,
          this.github.getStatusLabel(newStatus),
        );
      } catch (err) {
        logger.error(`更新看板状态失败 #${issueNumber}:`, err);
      }
    }

    // 发送事件
    const event: StatusChangeEvent = {
      issueNumber,
      title: req.title,
      from: oldStatus,
      to: newStatus,
      triggeredBy,
      timestamp: Date.now(),
      metadata,
    };

    this.eventBus.emitStatusChange(event);
    return true;
  }

  /**
   * 更新需求的附加属性（不触发状态变更）
   */
  update(issueNumber: number, updates: Partial<Omit<Requirement, 'issueNumber' | 'status'>>): void {
    const req = this.requirements.get(issueNumber);
    if (!req) return;
    Object.assign(req, updates, { updatedAt: Date.now() });
  }

  dispose(): void {
    this.requirements.clear();
    this.itemIds.clear();
  }
}
