import { randomUUID } from 'node:crypto';
import { createDeliveryTarget, type DeliveryTarget, type OutboundHost, type PluginStateStore } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { ReminderConfig } from './config.js';

export const REMINDER_STATE_KEY = 'reminders/v1';
export const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60;
export class ReminderInputError extends Error {}

type TaskStatus = 'pending' | 'unknown' | 'delivered' | 'failed' | 'cancelled';
export type ReminderActor = { readonly senderId: string; readonly target: DeliveryTarget };
export type ReminderTask = {
  readonly id: string; readonly senderId: string; readonly target: DeliveryTarget;
  readonly text: string; readonly createdAt: number; readonly nextRunAt: number;
  readonly intervalMs: number | null; readonly status: TaskStatus;
  readonly claimId: string | null; readonly lastRunAt: number | null; readonly detail: string;
};
export type ReminderBook = { readonly version: 1; readonly tasks: readonly ReminderTask[] };

/** Generation-owned worker; saved state contains plain identities, never live objects. */
export class ReminderService {
  readonly #state: PluginStateStore;
  readonly #outbound: OutboundHost;
  readonly #config: ReminderConfig;
  #working = false;
  #stopped = false;

  constructor(state: PluginStateStore, outbound: OutboundHost, config: ReminderConfig) {
    this.#state = state;
    this.#outbound = outbound;
    this.#config = config;
  }

  stop(): void { this.#stopped = true; }

  async add(actor: ReminderActor, text: string, at: number, intervalMs: number | null): Promise<ReminderTask> {
    this.#assertLive();
    assertActor(actor);
    const now = Date.now();
    if (!text.trim() || text.length > 500) throw new ReminderInputError('提醒内容须为 1–500 个字符');
    if (!Number.isSafeInteger(at) || at <= now || at - now > MAX_DELAY_SECONDS * 1000) throw new ReminderInputError('提醒时间须在未来一年内');
    if (intervalMs !== null && (!Number.isSafeInteger(intervalMs) || intervalMs < 60_000 || intervalMs > MAX_DELAY_SECONDS * 1000)) throw new ReminderInputError('周期须为 60 秒至一年');
    const task: ReminderTask = { id: randomUUID(), senderId: actor.senderId, target: createDeliveryTarget({ conversation: actor.target }),
      text, createdAt: now, nextRunAt: at, intervalMs, status: 'pending', claimId: null, lastRunAt: null, detail: '' };
    await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => {
      const book = readBook(current);
      // Completed history is disposable; unconfirmed tasks require an explicit
      // user decision and continue to count against the storage quota.
      const active = book.tasks.filter(item => item.status === 'pending' || item.status === 'unknown');
      if (active.length >= this.#config.maxTasks) throw new ReminderInputError('此插件实例的提醒数量已达上限，请先取消任务');
      if (active.filter(item => sameActor(item, actor)).length >= this.#config.maxTasksPerSender) throw new ReminderInputError('你在此会话的提醒数量已达上限，请先取消任务');
      const historyLimit = Math.max(0, this.#config.maxTasks - active.length - 1);
      const history = historyLimit > 0 ? book.tasks.filter(item => item.status !== 'pending' && item.status !== 'unknown').slice(-historyLimit) : [];
      return boundedBook([...active, ...history, task]);
    });
    return task;
  }

  async list(actor: ReminderActor): Promise<readonly ReminderTask[]> {
    this.#assertLive();
    assertActor(actor);
    return readBook(await this.#state.get<ReminderBook>(REMINDER_STATE_KEY)).tasks.filter(item => sameActor(item, actor));
  }

  async cancel(actor: ReminderActor, id: string): Promise<boolean> {
    this.#assertLive();
    assertActor(actor);
    const book = await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => ({ version: 1,
      tasks: readBook(current).tasks.map(task => task.id === id && sameActor(task, actor)
        ? { ...task, status: 'cancelled', detail: '用户取消；已经开始的投递无法撤销' } : task),
    }));
    return !!book?.tasks.some(task => task.id === id && sameActor(task, actor) && task.status === 'cancelled');
  }

  async tick(): Promise<void> {
    if (this.#working || this.#stopped) return;
    this.#working = true;
    try {
      for (let count = 0; count < this.#config.batchSize && !this.#stopped; count++) {
        const now = Date.now();
        const claimId = randomUUID();
        const book = await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => {
          let claimed = false;
          return { version: 1, tasks: readBook(current).tasks.map(task => {
            if (task.status !== 'pending' || task.nextRunAt > now) return task;
            if (task.intervalMs !== null && now - task.nextRunAt > this.#config.missedGraceSeconds * 1000) {
              return { ...task, nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, now), detail: '已跳过错过的周期轮次' };
            }
            if (claimed) return task;
            claimed = true;
            // Persist the conservative disposition before touching the external
            // platform. A crash here cannot cause an automatic duplicate send.
            return { ...task, status: 'unknown', claimId, lastRunAt: now, detail: '投递中或未确认；不会自动重试' };
          }) };
        });
        const task = book?.tasks.find(item => item.claimId === claimId);
        if (!task || this.#stopped) break;
        let status: TaskStatus = 'unknown';
        let detail = '平台未返回确认的消息 ID；不会自动重试';
        try {
          const id = await this.#outbound.sendTarget!(task.target, `⏰ 提醒：${task.text}`);
          if (id) { status = task.intervalMs === null ? 'delivered' : 'pending'; detail = '已确认投递'; }
        } catch (error) {
          if (error instanceof EndpointDeliveryError && error.disposition !== 'unknown') {
            status = 'failed'; detail = `投递失败：${error.code}；任务已停止`;
          } else detail = '投递结果未确认；请核对目标会话后取消或重新创建';
        }
        await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => ({ version: 1,
          tasks: readBook(current).tasks.map(item => item.id === task.id && item.claimId === claimId && item.status === 'unknown'
            ? { ...item, status, detail, ...(status === 'pending' && task.intervalMs !== null
              ? { nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, Date.now()) } : {}) } : item),
        }));
      }
    } finally { this.#working = false; }
  }

  describe(task: ReminderTask): string {
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone: this.#config.timezone, dateStyle: 'short', timeStyle: 'medium' }).format(task.nextRunAt);
    const state = { pending: '待触发', unknown: '投递中或未确认', delivered: '已完成', failed: '投递失败', cancelled: '已取消' }[task.status];
    return `${task.id} | ${state} | ${date} (${this.#config.timezone})${task.intervalMs === null ? '' : ` | 每 ${task.intervalMs / 1000} 秒`}`
      + `\n${task.text}${task.detail ? `\n${task.detail}` : ''}`;
  }

  #assertLive(): void { if (this.#stopped) throw new Error('提醒服务属于已停止的插件实例'); }
}

export function parseReminderInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) throw new TypeError('绝对时间须为带 Z 或 ±hh:mm 的 ISO 时间，例如 2026-10-14T09:00:00+08:00');
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u)!.slice(1).map(item => Number(item ?? 0));
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month, 0);
  const daysInMonth = calendar.getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) throw new TypeError('提醒时间无效');
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time)) throw new TypeError('提醒时间无效');
  return time;
}

function nextPeriodicTime(from: number, interval: number, now: number): number {
  return from + (Math.floor((now - from) / interval) + 1) * interval;
}
function sameActor(task: ReminderTask, actor: ReminderActor): boolean {
  return task.senderId === actor.senderId && JSON.stringify(task.target) === JSON.stringify(createDeliveryTarget({ conversation: actor.target }));
}
function readBook(value: ReminderBook | undefined): ReminderBook {
  if (value === undefined) return { version: 1, tasks: [] };
  try {
    if (value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 32) throw new Error('Invalid book');
    for (const task of value.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || typeof task.senderId !== 'string' || !task.senderId
        || typeof task.text !== 'string' || !task.text.trim() || task.text.length > 500
        || !Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.nextRunAt)
        || (task.intervalMs !== null && (!Number.isSafeInteger(task.intervalMs) || task.intervalMs < 60_000 || task.intervalMs > MAX_DELAY_SECONDS * 1000))
        || !['pending', 'unknown', 'delivered', 'failed', 'cancelled'].includes(task.status)
        || (task.claimId !== null && typeof task.claimId !== 'string')
        || (task.lastRunAt !== null && !Number.isSafeInteger(task.lastRunAt)) || typeof task.detail !== 'string') throw new Error('Invalid task');
      createDeliveryTarget({ conversation: task.target });
    }
    return boundedBook(value.tasks);
  } catch { throw new Error('提醒持久状态格式无效，已停止投递'); }
}
function boundedBook(tasks: readonly ReminderTask[]): ReminderBook {
  const book: ReminderBook = { version: 1, tasks };
  if (new TextEncoder().encode(JSON.stringify(book)).byteLength > 60 * 1024) throw new ReminderInputError('提醒存储达到大小上限，请先取消旧任务');
  return book;
}

function assertActor(actor: ReminderActor): void {
  if (!actor.senderId) throw new ReminderInputError('提醒需要真实发送者');
  createDeliveryTarget({ conversation: actor.target });
}
