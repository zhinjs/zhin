/**
 * @zhin.js/devteam - 事件总线
 *
 * 管理 Agent 间的状态变更事件分发
 */

import { EventEmitter } from 'events';
import { Logger } from 'zhin.js';
import type {
  StatusChangeEvent,
  RequirementStatusValue,
  AgentRoleValue,
} from './types.js';
import { STATUS_OWNER, STATUS_LABELS } from './types.js';

const logger = new Logger(null, 'DevTeam:EventBus');

export class DevTeamEventBus extends EventEmitter {
  /**
   * 发布状态变更事件
   * 自动路由到对应角色的监听器
   */
  emitStatusChange(event: StatusChangeEvent): void {
    const targetRole = STATUS_OWNER[event.to];
    const label = STATUS_LABELS[event.to];

    logger.info(
      `状态变更: #${event.issueNumber} "${event.title}" [${STATUS_LABELS[event.from]}] → [${label}]` +
      ` (负责: ${targetRole}, 触发者: ${event.triggeredBy})`
    );

    // 通用事件
    this.emit('status:change', event);
    // 按目标状态分发
    this.emit(`status:${event.to}`, event);
    // 按角色分发
    this.emit(`role:${targetRole}`, event);
  }

  /**
   * 监听特定状态变更
   */
  onStatus(status: RequirementStatusValue, handler: (event: StatusChangeEvent) => void | Promise<void>): void {
    this.on(`status:${status}`, handler);
  }

  /**
   * 监听分配给特定角色的事件
   */
  onRole(role: AgentRoleValue, handler: (event: StatusChangeEvent) => void | Promise<void>): void {
    this.on(`role:${role}`, handler);
  }

  /**
   * 监听所有状态变更
   */
  onAnyStatusChange(handler: (event: StatusChangeEvent) => void | Promise<void>): void {
    this.on('status:change', handler);
  }

  dispose(): void {
    this.removeAllListeners();
  }
}
