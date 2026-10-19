import { createHash, randomUUID } from 'node:crypto';
import { createDeliveryTarget, type DeliveryTarget, type OutboundHost, type PluginStateStore } from 'zhin.js';
import { PluginTaskError, createGenerationAdmissionGate, generationAdmissionSource, type JsonValue, type PluginTask, type PluginTaskAction, type PluginTaskMutation,
  type PluginTaskProvider, type PluginTaskSnapshot } from 'zhin.js/plugin-runtime';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { ReminderConfig } from './config.js';
import { MAX_DELAY_SECONDS, nextPeriodicTime, parseReminderInstant } from './timing.js';

export const ADMIN_REMINDER_STATE_KEY = 'admin-reminders/v1';
type AdminTask = {
  readonly id: string; readonly creation: string; readonly target: DeliveryTarget; readonly text: string;
  readonly createdAt: number; readonly nextRunAt: number; readonly intervalMs: number | null;
  readonly state: Exclude<PluginTask['state'], 'running'>; readonly claimId: string | null;
  readonly lastRunAt: number | null; readonly detail: string;
};
type MutationReceipt = { readonly id: string; readonly fingerprint: string; readonly taskId: string; readonly operation: 'create' | PluginTaskAction };
export type AdminReminderBook = { readonly version: 1; readonly revision: string;
  readonly tasks: readonly AdminTask[]; readonly receipts: readonly MutationReceipt[] };
type Parameters = { readonly text: string; readonly at: string; readonly intervalSeconds?: number };
const activeStates = new Set<AdminTask['state']>(['scheduled', 'paused', 'unknown']);
const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

/** A separate administrator state pool; no sender identity and no access to chat reminders. */
export class AdministratorReminderTasks implements PluginTaskProvider {
  readonly title = '管理员提醒';
  readonly description = '独立于聊天个人提醒，向指定账号、会话及线程发送一次性或固定周期提醒';
  readonly effects = ['创建后将在指定时间通过当前插件实例向目标会话发送提醒；暂停或取消不能撤回已开始的投递', '未确认的投递不会自动重试或恢复，需核实目标会话后取消并另建任务'];
  readonly schema = { type: 'object', additionalProperties: false, required: ['text', 'at'], properties: {
    text: { type: 'string', minLength: 1, maxLength: 500, title: '提醒内容' },
    at: { type: 'string', format: 'date-time', title: '首次执行时间', description: '未来一年内、显式包含 Z 或 ±hh:mm 的 ISO 时间' },
    intervalSeconds: { type: 'integer', minimum: 60, maximum: MAX_DELAY_SECONDS, title: '周期秒数（可选）' },
  } } as const;
  #stopped = false;
  readonly #admission = createGenerationAdmissionGate();
  get [generationAdmissionSource]() { return [this.#admission]; }
  constructor(private readonly state: PluginStateStore, private readonly outbound: OutboundHost, private readonly config: ReminderConfig) {}
  stop(): void { this.#stopped = true; }

  async read(): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => this.#snapshot(readBook(await this.state.get<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY))));
  }

  async create(input: PluginTaskMutation & Readonly<{ target: DeliveryTarget; parameters: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(() => this.#create(input));
  }
  async #create(input: PluginTaskMutation & Readonly<{ target: DeliveryTarget; parameters: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    this.#assertLive(); assertMutation(input);
    let target: DeliveryTarget;
    try { target = createDeliveryTarget({ conversation: input.target }); } catch { throw invalid('请提供完整有效的目标账号、会话、父容器和线程'); }
    const parameters = parseParameters(input.parameters);
    const fingerprint = digest({ operation: 'create', target, parameters });
    const revision = randomUUID(); const now = Date.now();
    const task: AdminTask = { id: input.requestId, creation: fingerprint, target, text: parameters.text, createdAt: now,
      nextRunAt: Date.parse(parameters.at), intervalMs: parameters.intervalSeconds === undefined ? null : parameters.intervalSeconds * 1000,
      state: 'scheduled', claimId: null, lastRunAt: null, detail: '等待执行' };
    const result = await this.state.update<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY, current => {
      this.#assertLive(); const book = readBook(current);
      if (reconcile(book, input.requestId, fingerprint)) return book;
      assertRevision(book, input.expectedRevision);
      const existing = book.tasks.find(item => item.id === input.requestId);
      if (existing) { if (existing.creation !== fingerprint) throw conflict('同一请求 ID 已用于其他内容'); return book; }
      assertFuture(task.nextRunAt, now);
      const active = book.tasks.filter(item => activeStates.has(item.state));
      if (active.length >= this.config.adminMaxTasks) throw invalid('管理员提醒池已达上限，请先取消任务；聊天个人提醒使用独立配额');
      const historyLimit = Math.max(0, this.config.adminMaxTasks - active.length - 1);
      const history = historyLimit ? book.tasks.filter(item => !activeStates.has(item.state)).slice(-historyLimit) : [];
      return bounded({ ...book, revision, tasks: [...active, ...history, task], receipts: receipt(book, input.requestId, fingerprint, task.id, 'create') });
    });
    return this.#snapshot(readBook(result));
  }

  async change(input: PluginTaskMutation & Readonly<{ id: string; action: PluginTaskAction; parameters?: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(() => this.#change(input));
  }
  async #change(input: PluginTaskMutation & Readonly<{ id: string; action: PluginTaskAction; parameters?: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    this.#assertLive(); assertMutation(input);
    if (typeof input.id !== 'string' || !uuidPattern.test(input.id) || !['pause', 'resume', 'cancel', 'update'].includes(input.action)) throw invalid('任务 ID 或操作无效');
    if (input.action !== 'update' && input.parameters !== undefined) throw invalid('仅编辑操作接受参数');
    const parameters = input.action === 'update' ? parseParameters(input.parameters) : undefined;
    const fingerprint = digest({ operation: 'change', id: input.id, action: input.action, parameters: parameters ?? null });
    const revision = randomUUID(); const now = Date.now();
    const result = await this.state.update<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY, current => {
      this.#assertLive(); const book = readBook(current);
      if (reconcile(book, input.requestId, fingerprint)) return book;
      assertRevision(book, input.expectedRevision);
      const task = book.tasks.find(item => item.id === input.id);
      if (!task) throw new PluginTaskError('not_found', '未找到当前实例的管理员任务；聊天任务不在此入口管理');
      let changed: AdminTask;
      switch (input.action) {
        case 'pause':
          if (task.state !== 'scheduled') throw invalid('仅待执行任务可以暂停；未确认投递不能暂停或恢复');
          changed = { ...task, state: 'paused', detail: '管理员暂停' }; break;
        case 'resume': {
          if (task.state !== 'paused') throw invalid('仅已暂停任务可以恢复；未确认投递不能恢复或重试');
          if (task.intervalMs === null && task.nextRunAt <= now) throw invalid('一次性任务时间已过，请先编辑为未来时间再恢复');
          const nextRunAt = task.nextRunAt <= now && task.intervalMs !== null ? nextPeriodicTime(task.nextRunAt, task.intervalMs, now) : task.nextRunAt;
          changed = { ...task, state: 'scheduled', nextRunAt, detail: nextRunAt !== task.nextRunAt ? '已恢复，并跳过错过的周期轮次' : '管理员恢复' }; break;
        }
        case 'update':
          if (task.state !== 'paused') throw invalid('编辑前请先暂停任务；未确认投递不能编辑');
          assertFuture(Date.parse(parameters!.at), now);
          changed = { ...task, text: parameters!.text, nextRunAt: Date.parse(parameters!.at),
            intervalMs: parameters!.intervalSeconds === undefined ? null : parameters!.intervalSeconds * 1000, detail: '已编辑，保持暂停；请确认后恢复' }; break;
        case 'cancel':
          if (!activeStates.has(task.state)) throw invalid('任务已结束，不能再次取消');
          changed = { ...task, state: 'cancelled', detail: '管理员取消；已经开始的投递无法撤回' }; break;
      }
      return bounded({ ...book, revision, tasks: book.tasks.map(item => item.id === task.id ? changed : item), receipts: receipt(book, input.requestId, fingerprint, task.id, input.action) });
    });
    return this.#snapshot(readBook(result));
  }

  /** Called only by the existing ReminderService worker, within its shared batch limit. */
  async claim(now: number, claimId: string): Promise<AdminTask | undefined> {
    this.#assertLive(); const revision = randomUUID();
    const book = await this.state.update<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY, current => {
      const book = readBook(current); let claimed = false; let changed = false;
      const tasks = book.tasks.map(task => {
        if (task.state !== 'scheduled' || task.nextRunAt > now) return task;
        if (task.intervalMs !== null && now - task.nextRunAt > this.config.missedGraceSeconds * 1000) {
          changed = true; return { ...task, nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, now), detail: '已跳过错过的周期轮次' };
        }
        if (claimed) return task;
        changed = claimed = true;
        return { ...task, state: 'unknown' as const, claimId, lastRunAt: now, detail: '投递中或未确认；不会自动重试' };
      });
      return changed ? bounded({ ...book, revision, tasks }) : current;
    });
    return book?.tasks.find(task => task.claimId === claimId);
  }

  async deliver(task: AdminTask): Promise<void> {
    if (this.#stopped) return;
    let state: AdminTask['state'] = 'unknown'; let detail = '平台未确认投递，请核实目标会话后取消并另建任务；不会自动重试';
    try {
      const id = await this.outbound.sendTarget!(task.target, `⏰ 提醒：${task.text}`);
      if (id) { state = task.intervalMs === null ? 'succeeded' : 'scheduled'; detail = '已确认投递'; }
    } catch (error) {
      if (error instanceof EndpointDeliveryError && error.disposition !== 'unknown') { state = 'failed'; detail = '平台明确未投递或拒绝；任务已停止'; }
    }
    const revision = randomUUID();
    await this.state.update<AdminReminderBook>(ADMIN_REMINDER_STATE_KEY, current => {
      const book = readBook(current); let changed = false;
      const tasks = book.tasks.map(item => {
        if (item.id !== task.id || item.claimId !== task.claimId || item.state !== 'unknown') return item;
        changed = true;
        return { ...item, state, detail, ...(state === 'scheduled' && task.intervalMs !== null
          ? { nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, Date.now()) } : {}) };
      });
      return changed ? bounded({ ...book, revision, tasks }) : current;
    });
  }

  #assertLive(): void { if (this.#stopped) throw new PluginTaskError('unavailable', '管理员提醒服务属于已停止的插件实例'); }
  async #admit<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertLive(); const release = this.#admission.acquire();
    if (!release) throw new PluginTaskError('unavailable', '管理员提醒服务属于未发布或已退役的 generation');
    try { return await operation(); } finally { release(); }
  }
  #snapshot(book: AdminReminderBook): PluginTaskSnapshot {
    return { revision: book.revision, receipts: book.receipts.map(item => ({ requestId: item.id, taskId: item.taskId, operation: item.operation })), tasks: book.tasks.map(task => ({
      id: task.id, ownership: 'administrator', title: taskTitle(task.text), target: task.target, state: task.state, createdAt: task.createdAt,
      ...(task.state === 'scheduled' || task.state === 'paused' ? { nextRunAt: task.nextRunAt } : {}), ...(task.lastRunAt === null ? {} : { lastRunAt: task.lastRunAt }),
      timezone: this.config.timezone, detail: `${task.detail}；状态仅表示调度事实，不代表平台连接或投递健康`,
      parameters: { text: task.text, at: new Date(task.nextRunAt).toISOString(), ...(task.intervalMs === null ? {} : { intervalSeconds: task.intervalMs / 1000 }) },
      actions: task.state === 'scheduled' ? ['pause', 'cancel'] : task.state === 'paused' ? ['update', 'resume', 'cancel'] : task.state === 'unknown' ? ['cancel'] : [],
    })) };
  }
}

function assertMutation(input: PluginTaskMutation): void {
  if (typeof input.requestId !== 'string' || !uuidPattern.test(input.requestId) || typeof input.expectedRevision !== 'string' || !input.expectedRevision || input.expectedRevision.length > 128) throw invalid('操作须包含 UUID requestId 和读取到的 expectedRevision');
}
function parseParameters(value: Readonly<Record<string, JsonValue>> | undefined): Parameters {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !['text', 'at', 'intervalSeconds'].includes(key))
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 500 || typeof value.at !== 'string'
    || (value.intervalSeconds !== undefined && (typeof value.intervalSeconds !== 'number' || !Number.isSafeInteger(value.intervalSeconds) || value.intervalSeconds < 60 || value.intervalSeconds > MAX_DELAY_SECONDS))) throw invalid('参数须包含 1–500 字提醒内容、带 offset 的 ISO 时间及可选的 60 秒至一年整数周期');
  let at: number;
  try { at = parseReminderInstant(value.at); } catch { throw invalid('提醒时间须为有效且带 Z 或 ±hh:mm 的 ISO 时间'); }
  return { text: value.text, at: new Date(at).toISOString(), ...(value.intervalSeconds === undefined ? {} : { intervalSeconds: value.intervalSeconds as number }) };
}
function assertFuture(at: number, now: number): void {
  if (!Number.isSafeInteger(at) || at <= now || at - now > MAX_DELAY_SECONDS * 1000) throw invalid('提醒时间须在未来一年内');
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function taskTitle(text: string): string {
  if (text.length <= 200) return text;
  let title = '';
  for (const character of text) {
    if (title.length + character.length > 199) break;
    title += character;
  }
  return `${title}…`;
}
function reconcile(book: AdminReminderBook, id: string, fingerprint: string): boolean {
  const previous = book.receipts.find(item => item.id === id);
  if (!previous) return false;
  if (previous.fingerprint !== fingerprint) throw conflict('同一操作请求 ID 已用于其他内容，禁止重放');
  return true;
}
function assertRevision(book: AdminReminderBook, revision: string): void { if (book.revision !== revision) throw conflict('任务列表已变化，请刷新后重新确认操作'); }
function receipt(book: AdminReminderBook, id: string, fingerprint: string, taskId: string, operation: MutationReceipt['operation']): readonly MutationReceipt[] {
  return [...book.receipts, { id, fingerprint, taskId, operation }].slice(-128);
}
function invalid(message: string): PluginTaskError { return new PluginTaskError('invalid_input', message); }
function conflict(message: string): PluginTaskError { return new PluginTaskError('conflict', message); }
function bounded(book: AdminReminderBook): AdminReminderBook {
  if (book.tasks.length > 32 || new TextEncoder().encode(JSON.stringify(book)).byteLength > 60 * 1024) throw invalid('管理员提醒池状态达到 32 条或 60 KiB 上限，请先取消并整理任务');
  return book;
}
function readBook(value: AdminReminderBook | undefined): AdminReminderBook {
  if (value === undefined) return { version: 1, revision: '0', tasks: [], receipts: [] };
  try {
    if (value.version !== 1 || typeof value.revision !== 'string' || !value.revision || !Array.isArray(value.tasks) || !Array.isArray(value.receipts) || value.receipts.length > 128) throw new Error('invalid book');
    for (const item of value.receipts) if (!item || !uuidPattern.test(item.id) || !uuidPattern.test(item.taskId)
      || !['create', 'pause', 'resume', 'cancel', 'update'].includes(item.operation) || !/^[\da-f]{64}$/u.test(item.fingerprint)) throw new Error('invalid receipt');
    const ids = new Set<string>();
    for (const task of value.tasks) {
      if (!task || !uuidPattern.test(task.id) || ids.has(task.id) || typeof task.creation !== 'string' || !/^[\da-f]{64}$/u.test(task.creation)
        || typeof task.text !== 'string' || !task.text.trim() || task.text.length > 500 || !Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.nextRunAt)
        || (task.intervalMs !== null && (!Number.isSafeInteger(task.intervalMs) || task.intervalMs < 60_000 || task.intervalMs > MAX_DELAY_SECONDS * 1000))
        || !['scheduled', 'paused', 'unknown', 'succeeded', 'failed', 'cancelled'].includes(task.state)
        || (task.claimId !== null && (typeof task.claimId !== 'string' || !task.claimId)) || (task.lastRunAt !== null && !Number.isSafeInteger(task.lastRunAt))
        || typeof task.detail !== 'string' || !Number.isFinite(new Date(task.nextRunAt).getTime())) throw new Error('invalid task');
      createDeliveryTarget({ conversation: task.target }); ids.add(task.id);
    }
    return bounded(value);
  } catch { throw new PluginTaskError('unavailable', '管理员提醒持久状态格式无效，已停止投递'); }
}
