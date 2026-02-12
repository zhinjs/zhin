/**
 * FollowUpStore — 定时跟进任务的持久化存储
 *
 * 解决纯 setTimeout 重启即丢失的问题：
 *   1. 创建任务时同步写入数据库
 *   2. 执行完成 / 过期后从数据库中删除
 *   3. 机器人启动时从数据库加载所有未完成任务，重新挂定时器
 *   4. 同一会话创建新任务时，自动取消旧的 pending 任务（防止重复提醒）
 *
 *   ai_followups 表：
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ id (PK)  | session_id | platform | sender_id | scene_id        │
 *   │          | message    | fire_at  | created_at | status          │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { Logger } from '@zhin.js/logger';

const logger = new Logger(null, 'FollowUp');

// ============================================================================
// 数据库模型
// ============================================================================

export const AI_FOLLOWUP_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  sender_id: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  scene_type: { type: 'text' as const, nullable: false },
  message: { type: 'text' as const, nullable: false },
  /** 触发时间戳 (ms) */
  fire_at: { type: 'integer' as const, nullable: false },
  created_at: { type: 'integer' as const, default: 0 },
  /** pending | fired | cancelled */
  status: { type: 'text' as const, default: 'pending' },
};

// ============================================================================
// 类型
// ============================================================================

export interface FollowUpRecord {
  id?: number;
  session_id: string;
  platform: string;
  bot_id: string;
  sender_id: string;
  scene_id: string;
  scene_type: string;
  message: string;
  fire_at: number;
  created_at: number;
  status: string;
}

/**
 * 数据库模型接口（与 RelatedModel 的链式查询 API 对齐）
 */
interface DbModel {
  select(...fields: string[]): any;  // 返回 Selection (thenable, 支持 .where())
  create(data: Record<string, any>): Promise<any>;
  update(data: Partial<any>): any;   // 返回 Updation (thenable, 支持 .where())
  delete(condition: Record<string, any>): any; // 返回 Deletion (thenable, 支持 .where())
}

/**
 * 发送提醒的回调函数
 *
 * 由 ZhinAgent 在 init 阶段注入，负责把提醒消息发到正确的会话。
 */
export type FollowUpSender = (record: FollowUpRecord) => Promise<void>;

// ============================================================================
// Store 接口
// ============================================================================

interface IFollowUpStore {
  create(record: Omit<FollowUpRecord, 'id'>): Promise<FollowUpRecord>;
  markFired(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
  getPending(): Promise<FollowUpRecord[]>;
  getPendingBySession(sessionId: string): Promise<FollowUpRecord[]>;
  dispose(): void;
}

// ============================================================================
// 内存实现
// ============================================================================

class MemoryFollowUpStore implements IFollowUpStore {
  private records: FollowUpRecord[] = [];
  private nextId = 1;

  async create(record: Omit<FollowUpRecord, 'id'>): Promise<FollowUpRecord> {
    const full: FollowUpRecord = { ...record, id: this.nextId++ };
    this.records.push(full);
    return full;
  }

  async markFired(id: number): Promise<void> {
    const r = this.records.find(r => r.id === id);
    if (r) r.status = 'fired';
  }

  async cancel(id: number): Promise<void> {
    const r = this.records.find(r => r.id === id);
    if (r) r.status = 'cancelled';
  }

  async getPending(): Promise<FollowUpRecord[]> {
    return this.records.filter(r => r.status === 'pending');
  }

  async getPendingBySession(sessionId: string): Promise<FollowUpRecord[]> {
    return this.records.filter(r => r.status === 'pending' && r.session_id === sessionId);
  }

  dispose(): void {
    this.records = [];
  }
}

// ============================================================================
// 数据库实现
// ============================================================================

class DatabaseFollowUpStore implements IFollowUpStore {
  constructor(private model: DbModel) {}

  async create(record: Omit<FollowUpRecord, 'id'>): Promise<FollowUpRecord> {
    const created = await this.model.create(record);
    return { ...record, id: created.id ?? created };
  }

  async markFired(id: number): Promise<void> {
    await this.model.update({ status: 'fired' }).where({ id });
  }

  async cancel(id: number): Promise<void> {
    await this.model.update({ status: 'cancelled' }).where({ id });
  }

  async getPending(): Promise<FollowUpRecord[]> {
    return this.model.select().where({ status: 'pending' }) as Promise<FollowUpRecord[]>;
  }

  async getPendingBySession(sessionId: string): Promise<FollowUpRecord[]> {
    return this.model.select().where({ status: 'pending', session_id: sessionId }) as Promise<FollowUpRecord[]>;
  }

  dispose(): void {}
}

// ============================================================================
// FollowUpManager
// ============================================================================

export class FollowUpManager {
  private store: IFollowUpStore;
  /** 内存中活跃的定时器: recordId → timer */
  private timers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private sender: FollowUpSender | null = null;

  constructor() {
    this.store = new MemoryFollowUpStore();
  }

  /** 注入消息发送回调 */
  setSender(sender: FollowUpSender): void {
    this.sender = sender;
  }

  /** 升级到数据库存储 */
  upgradeToDatabase(model: DbModel): void {
    const old = this.store;
    this.store = new DatabaseFollowUpStore(model);
    old.dispose();
    logger.debug('FollowUpManager: 已升级到数据库存储');
  }

  /**
   * 创建一个跟进任务
   *
   * 重要：同一会话的旧 pending 任务会被自动取消，防止重复提醒。
   *
   * @returns 人类可读的确认文本
   */
  async schedule(params: {
    sessionId: string;
    platform: string;
    botId: string;
    senderId: string;
    sceneId: string;
    sceneType: string;
    message: string;
    delayMinutes: number;
  }): Promise<string> {
    const { sessionId, platform, botId, senderId, sceneId, sceneType, message, delayMinutes } = params;

    // ── 详细参数日志（方便排查问题） ──
    logger.debug(`[跟进] 收到请求: delay_minutes=${delayMinutes}, message="${message}", session=${sessionId}`);

    // 限制最大延迟 7 天
    const maxDelay = 7 * 24 * 60;
    const actualDelay = Math.min(Math.max(delayMinutes, 1), maxDelay);
    const delayMs = actualDelay * 60 * 1000;
    const fireAt = Date.now() + delayMs;

    // ── 自动取消同一会话的旧 pending 任务 ──
    const existingPending = await this.store.getPendingBySession(sessionId);
    if (existingPending.length > 0) {
      for (const old of existingPending) {
        if (old.id != null) {
          // 取消数据库记录
          await this.store.cancel(old.id);
          // 清除内存中的定时器
          const timer = this.timers.get(old.id);
          if (timer) {
            clearTimeout(timer);
            this.timers.delete(old.id);
          }
          logger.debug(`[跟进] 自动取消旧任务: id=${old.id}, "${old.message}"`);
        }
      }
    }

    const record = await this.store.create({
      session_id: sessionId,
      platform,
      bot_id: botId,
      sender_id: senderId,
      scene_id: sceneId,
      scene_type: sceneType,
      message,
      fire_at: fireAt,
      created_at: Date.now(),
      status: 'pending',
    });

    // 挂定时器
    this.scheduleTimer(record);

    const readableTime = actualDelay >= 1440
      ? `${(actualDelay / 1440).toFixed(1)} 天后`
      : actualDelay >= 60
      ? `${(actualDelay / 60).toFixed(1)} 小时后`
      : `${actualDelay} 分钟后`;

    // 精确触发时间（方便日志对照）
    const fireDate = new Date(fireAt);
    const fireTimeStr = fireDate.toLocaleString('zh-CN', { hour12: false });

    logger.debug(`[跟进] 已创建: id=${record.id}, delay=${actualDelay}分钟(${delayMs}ms), 触发时间=${fireTimeStr}, "${message}"`);
    return `✅ 已安排提醒，将在 ${readableTime}（${fireTimeStr}）提醒你：${message}`;
  }

  /**
   * 取消指定会话的所有 pending 任务
   */
  async cancelBySession(sessionId: string): Promise<number> {
    const pending = await this.store.getPendingBySession(sessionId);
    let count = 0;
    for (const record of pending) {
      if (record.id != null) {
        await this.store.cancel(record.id);
        const timer = this.timers.get(record.id);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(record.id);
        }
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`[跟进] 已取消 ${count} 个待执行任务 (session=${sessionId})`);
    }
    return count;
  }

  /**
   * 启动时从数据库恢复所有未完成的跟进任务
   */
  async restore(): Promise<number> {
    const pending = await this.store.getPending();
    const now = Date.now();
    let restored = 0;

    for (const record of pending) {
      if (record.fire_at <= now) {
        // 已过期但未执行 → 立即触发（延迟 2 秒，等系统完全就绪）
        const overdueSec = Math.round((now - record.fire_at) / 1000);
        logger.debug(`[跟进恢复] id=${record.id} 已过期 ${overdueSec}s，立即触发`);
        this.scheduleTimerWithDelay(record, 2000);
        restored++;
      } else {
        // 还没到时间 → 重新挂定时器
        this.scheduleTimer(record);
        const remainMs = record.fire_at - now;
        const remainMin = (remainMs / 60_000).toFixed(1);
        logger.debug(`[跟进恢复] id=${record.id} 剩余 ${remainMin} 分钟, "${record.message}"`);
        restored++;
      }
    }

    if (restored > 0) {
      logger.info(`[跟进恢复] 共恢复 ${restored} 个待执行任务`);
    }
    return restored;
  }

  /**
   * 为一条记录挂定时器
   */
  private scheduleTimer(record: FollowUpRecord): void {
    const delay = Math.max(record.fire_at - Date.now(), 0);
    this.scheduleTimerWithDelay(record, delay);
  }

  private scheduleTimerWithDelay(record: FollowUpRecord, delayMs: number): void {
    if (!record.id) return;

    // 清除旧定时器（如果有）
    const existing = this.timers.get(record.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        this.timers.delete(record.id!);

        // 发送提醒
        if (this.sender) {
          await this.sender(record);
          logger.info(`[跟进提醒] 已发送: id=${record.id}, "${record.message}"`);
        } else {
          logger.warn(`[跟进提醒] 无法发送 (sender 未注入): id=${record.id}`);
        }

        // 标记完成
        await this.store.markFired(record.id!);
      } catch (e) {
        logger.warn(`[跟进提醒] 发送失败: id=${record.id}`, e);
      }
    }, delayMs);

    this.timers.set(record.id, timer);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.store.dispose();
  }
}
