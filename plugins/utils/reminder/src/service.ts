import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import { randomUUID } from 'node:crypto';
import { createDeliveryTarget, type DeliveryTarget, type OutboundHost, type PluginStateStore } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { ReminderConfig } from './config.js';
import { AdministratorReminderTasks } from './admin-tasks.js';
import { MAX_DELAY_SECONDS, nextPeriodicTime } from './timing.js';
export { MAX_DELAY_SECONDS, parseReminderInstant } from './timing.js';

export const REMINDER_STATE_KEY = 'reminders/v1';
export class ReminderInputError extends Error {}

type ReminderDetailKey = 'userCancelled' | 'skipped' | 'unknown' | 'unconfirmed' | 'delivered' | 'deliveryFailed' | 'checkUnconfirmed';
const detailKeys: readonly ReminderDetailKey[] = ['userCancelled', 'skipped', 'unknown', 'unconfirmed', 'delivered', 'deliveryFailed', 'checkUnconfirmed'];
function taskDetail(locale: Locale | undefined, detailKey: ReminderDetailKey, failureCode?: string) {
  return { detailKey, detail: t(locale, detailKey, { code: failureCode ?? '' }), failureCode: failureCode ?? null };
}

type TaskStatus = 'pending' | 'unknown' | 'delivered' | 'failed' | 'cancelled';
export type ReminderActor = { readonly senderId: string; readonly target: DeliveryTarget; readonly locale?: Locale };
export type ReminderTask = {
  readonly id: string; readonly senderId: string; readonly target: DeliveryTarget;
  readonly locale?: Locale; readonly text: string; readonly createdAt: number; readonly nextRunAt: number;
  readonly intervalMs: number | null; readonly status: TaskStatus;
  readonly claimId: string | null; readonly lastRunAt: number | null; readonly detail: string; readonly detailKey?: ReminderDetailKey; readonly failureCode?: string | null;
};
export type ReminderBook = { readonly version: 1; readonly tasks: readonly ReminderTask[] };

/** Generation-owned worker; saved state contains plain identities, never live objects. */
export class ReminderService {
  readonly administratorTasks: AdministratorReminderTasks;
  readonly #state: PluginStateStore;
  readonly #outbound: OutboundHost;
  readonly #config: ReminderConfig;
  #working = false;
  #stopped = false;
  #administratorFirst = false;

  constructor(state: PluginStateStore, outbound: OutboundHost, config: ReminderConfig, projectLocale: Locale = 'zh-CN') {
    this.#state = state;
    this.#outbound = outbound;
    this.#config = config;
    this.administratorTasks = new AdministratorReminderTasks(state, outbound, config, projectLocale);
  }

  stop(): void { this.#stopped = true; this.administratorTasks.stop(); }

  async add(actor: ReminderActor, text: string, at: number, intervalMs: number | null): Promise<ReminderTask> {
    this.#assertLive(actor.locale);
    assertActor(actor);
    const now = Date.now();
    const locale = resolveLocale(actor.locale);
    if (!text.trim() || text.length > 500) throw new ReminderInputError(t(locale, 'contentInvalid'));
    if (!Number.isSafeInteger(at) || at <= now || at - now > MAX_DELAY_SECONDS * 1000) throw new ReminderInputError(t(locale, 'futureRequired'));
    if (intervalMs !== null && (!Number.isSafeInteger(intervalMs) || intervalMs < 60_000 || intervalMs > MAX_DELAY_SECONDS * 1000)) throw new ReminderInputError(t(locale, 'intervalInvalid'));
    const task: ReminderTask = { id: randomUUID(), senderId: actor.senderId, target: createDeliveryTarget({ conversation: actor.target }),
      locale, text, createdAt: now, nextRunAt: at, intervalMs, status: 'pending', claimId: null, lastRunAt: null, detail: '' };
    await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => {
      const book = readBook(current, locale);
      // Completed history is disposable; unconfirmed tasks require an explicit
      // user decision and continue to count against the storage quota.
      const active = book.tasks.filter(item => item.status === 'pending' || item.status === 'unknown');
      if (active.length >= this.#config.maxTasks) throw new ReminderInputError(t(locale, 'instanceLimit'));
      if (active.filter(item => sameActor(item, actor)).length >= this.#config.maxTasksPerSender) throw new ReminderInputError(t(locale, 'actorLimit'));
      const historyLimit = Math.max(0, this.#config.maxTasks - active.length - 1);
      const history = historyLimit > 0 ? book.tasks.filter(item => item.status !== 'pending' && item.status !== 'unknown').slice(-historyLimit) : [];
      return boundedBook([...active, ...history, task], locale);
    });
    return task;
  }

  async list(actor: ReminderActor): Promise<readonly ReminderTask[]> {
    this.#assertLive(actor.locale);
    assertActor(actor);
    return readBook(await this.#state.get<ReminderBook>(REMINDER_STATE_KEY), actor.locale).tasks.filter(item => sameActor(item, actor));
  }

  async cancel(actor: ReminderActor, id: string): Promise<boolean> {
    this.#assertLive(actor.locale);
    assertActor(actor);
    const book = await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => ({ version: 1,
      tasks: readBook(current, actor.locale).tasks.map(task => task.id === id && sameActor(task, actor)
        ? { ...task, status: 'cancelled', ...taskDetail(task.locale, 'userCancelled') } : task),
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
        const administratorFirst = this.#administratorFirst;
        // Persist priority across ticks too: batchSize=1 must not starve either pool.
        this.#administratorFirst = !this.#administratorFirst;
        if (administratorFirst) {
          const administratorTask = await this.administratorTasks.claim(now, claimId);
          if (this.#stopped) break;
          if (administratorTask) { await this.administratorTasks.deliver(administratorTask); continue; }
        }
        const book = await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => {
          let claimed = false;
          return { version: 1, tasks: readBook(current).tasks.map(task => {
            if (task.status !== 'pending' || task.nextRunAt > now) return task;
            if (task.intervalMs !== null && now - task.nextRunAt > this.#config.missedGraceSeconds * 1000) {
              return { ...task, nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, now), ...taskDetail(task.locale, 'skipped') };
            }
            if (claimed) return task;
            claimed = true;
            // Persist the conservative disposition before touching the external
            // platform. A crash here cannot cause an automatic duplicate send.
            return { ...task, status: 'unknown', claimId, lastRunAt: now, ...taskDetail(task.locale, 'unknown') };
          }) };
        });
        const task = book?.tasks.find(item => item.claimId === claimId);
        if (this.#stopped) break;
        if (!task) {
          if (administratorFirst) break;
          const administratorTask = await this.administratorTasks.claim(now, claimId);
          if (!administratorTask || this.#stopped) break;
          await this.administratorTasks.deliver(administratorTask);
          continue;
        }
        let status: TaskStatus = 'unknown';
        let detail = taskDetail(task.locale, 'unconfirmed');
        try {
          const id = await this.#outbound.sendTarget!(task.target, t(resolveLocale(task.locale), 'notification', { text: task.text }), { locale: resolveLocale(task.locale) });
          if (id) { status = task.intervalMs === null ? 'delivered' : 'pending'; detail = taskDetail(task.locale, 'delivered'); }
        } catch (error) {
          if (error instanceof EndpointDeliveryError && error.disposition !== 'unknown') {
            status = 'failed'; detail = taskDetail(task.locale, 'deliveryFailed', error.code);
          } else detail = taskDetail(task.locale, 'checkUnconfirmed');
        }
        await this.#state.update<ReminderBook>(REMINDER_STATE_KEY, current => ({ version: 1,
          tasks: readBook(current).tasks.map(item => item.id === task.id && item.claimId === claimId && item.status === 'unknown'
            ? { ...item, status, ...detail, ...(status === 'pending' && task.intervalMs !== null
              ? { nextRunAt: nextPeriodicTime(task.nextRunAt, task.intervalMs, Date.now()) } : {}) } : item),
        }));
      }
    } finally { this.#working = false; }
  }

  describe(task: ReminderTask, locale: Locale = resolveLocale(task.locale)): string {
    const date = new Intl.DateTimeFormat(locale, { timeZone: this.#config.timezone, dateStyle: 'short', timeStyle: 'medium' }).format(task.nextRunAt);
    const state = t(locale, { pending: 'pending', unknown: 'unknownStatus', delivered: 'deliveredStatus', failed: 'failedStatus', cancelled: 'cancelledStatus' }[task.status] as 'pending' | 'unknownStatus' | 'deliveredStatus' | 'failedStatus' | 'cancelledStatus');
    const detail = task.detailKey ? t(locale, task.detailKey, { code: task.failureCode ?? '' }) : task.detail;
    return `${task.id} | ${state} | ${date} (${this.#config.timezone})${task.intervalMs === null ? '' : ` | ${t(locale, 'every', { seconds: task.intervalMs / 1000 })}`}`
      + `\n${task.text}${detail ? `\n${detail}` : ''}`;
  }

  #assertLive(locale?: Locale): void { if (this.#stopped) throw new Error(t(locale, 'serviceStopped')); }
}

function sameActor(task: ReminderTask, actor: ReminderActor): boolean {
  return task.senderId === actor.senderId && JSON.stringify(task.target) === JSON.stringify(createDeliveryTarget({ conversation: actor.target }));
}
function readBook(value: ReminderBook | undefined, locale?: Locale): ReminderBook {
  if (value === undefined) return { version: 1, tasks: [] };
  try {
    if (value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 32) throw new Error('Invalid book');
    for (const task of value.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || typeof task.senderId !== 'string' || !task.senderId
        || typeof task.text !== 'string' || !task.text.trim() || task.text.length > 500
        || !Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.nextRunAt)
        || (task.intervalMs !== null && (!Number.isSafeInteger(task.intervalMs) || task.intervalMs < 60_000 || task.intervalMs > MAX_DELAY_SECONDS * 1000))
        || (task.locale !== undefined && task.locale !== 'zh-CN' && task.locale !== 'en')
        || (task.detailKey !== undefined && !detailKeys.includes(task.detailKey))
        || (task.failureCode != null && typeof task.failureCode !== 'string')
        || !['pending', 'unknown', 'delivered', 'failed', 'cancelled'].includes(task.status)
        || (task.claimId !== null && typeof task.claimId !== 'string')
        || (task.lastRunAt !== null && !Number.isSafeInteger(task.lastRunAt)) || typeof task.detail !== 'string') throw new Error('Invalid task');
      createDeliveryTarget({ conversation: task.target });
    }
    return boundedBook(value.tasks);
  } catch { throw new Error(t(locale, 'invalidState')); }
}
function boundedBook(tasks: readonly ReminderTask[], locale?: Locale): ReminderBook {
  const book: ReminderBook = { version: 1, tasks };
  if (new TextEncoder().encode(JSON.stringify(book)).byteLength > 60 * 1024) throw new ReminderInputError(t(locale, 'storageLimit'));
  return book;
}

function assertActor(actor: ReminderActor): void {
  if (!actor.senderId) throw new ReminderInputError(t(actor.locale, 'toolSender'));
  createDeliveryTarget({ conversation: actor.target });
}
