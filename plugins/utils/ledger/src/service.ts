import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { getLogger, type DeliveryTarget, type OutboundHost, type PluginDatabaseHost } from 'zhin.js';
import type { ResolvedLedgerConfig } from './config.js';
import { parseEntryInput } from './entry-input.js';
import type { LedgerCaller } from './identity.js';
import { formatCents, MASKED_AMOUNT } from './money.js';
import { isInPeriod, localDateKey, localTimeKey, periodLabel, type LedgerPeriod } from './period.js';
import {
  formatCategoryStatistics,
  formatEntryList,
  formatPeriodSummary,
  summarize,
  type LedgerReply,
} from './report-format.js';
import { LedgerStore, type LedgerEntry } from './store.js';

const logger = getLogger('ledger');

export type DailyReportAction = 'on' | 'off' | 'status';

export interface LedgerServiceOptions {
  /** Wall clock; tests pass a fake. */
  readonly now?: () => number;
}

/**
 * Personal expense ledger. Every operation is scoped to the caller's own `ownerKey`.
 *
 * Group privacy: replies that contain amounts go to the caller's private chat when the platform
 * can deliver there (`OutboundHost.sendTarget` exists and the send succeeds). Otherwise the
 * group gets the masked version. This is a capability check, not a per-platform list.
 */
export class LedgerService {
  readonly #store: LedgerStore;
  readonly #outbound: OutboundHost | undefined;
  readonly #config: ResolvedLedgerConfig;
  readonly #now: () => number;
  /** Serialises writes per user so two quick `记` commands never share an `#id`. */
  readonly #userQueues = new Map<string, Promise<unknown>>();
  /** Private targets already saved this process, to skip redundant writes. */
  readonly #knownPrivate = new Map<string, string>();

  constructor(database: PluginDatabaseHost, outbound: OutboundHost | undefined, config: ResolvedLedgerConfig, options: LedgerServiceOptions = {}) {
    this.#store = new LedgerStore(database);
    this.#outbound = outbound;
    this.#config = config;
    this.#now = options.now ?? (() => Date.now());
  }

  #withUserLock<T>(ownerKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#userQueues.get(ownerKey) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.catch(() => undefined);
    this.#userQueues.set(ownerKey, settled);
    void settled.then(() => {
      if (this.#userQueues.get(ownerKey) === settled) this.#userQueues.delete(ownerKey);
    });
    return next;
  }

  /**
   * Some platforms (Discord, Lark, Slack, ...) address a private chat by a conversation id that is
   * not the user id. When the user talks to the bot in private we save that real conversation and
   * use it for later private deliveries; until then the user id is the best available guess.
   */
  async #rememberPrivate(caller: LedgerCaller): Promise<void> {
    if (!caller.isPrivate) return;
    const raw = JSON.stringify(caller.conversation);
    if (this.#knownPrivate.get(caller.ownerKey) === raw) return;
    try {
      await this.#store.setPrivateTarget(caller.ownerKey, caller.conversation);
      this.#knownPrivate.set(caller.ownerKey, raw);
    } catch (error) {
      logger.warn(`saving private target failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async #privateTargetOf(caller: LedgerCaller): Promise<DeliveryTarget> {
    if (caller.isPrivate) return caller.conversation;
    return (await this.#store.getPrivateTarget(caller.ownerKey)) ?? caller.privateTarget;
  }

  async addEntry(caller: LedgerCaller, text: string): Promise<string> {
    await this.#rememberPrivate(caller);
    const parsed = parseEntryInput(text, caller.locale);
    if (!parsed.ok) return parsed.reason;
    const { category, amountCents, note } = parsed.entry;
    const seq = await this.#withUserLock(caller.ownerKey, async () => {
      const reserved = await this.#store.reserveSequence(caller.ownerKey);
      await this.#store.insertEntry({
        ownerKey: caller.ownerKey,
        seq: reserved,
        category,
        amountCents,
        note,
        createdAt: this.#now(),
      });
      return reserved;
    });
    const amount = caller.isPrivate ? formatCents(amountCents) : MASKED_AMOUNT;
    const noteText = note ? ` · ${note}` : '';
    return t(caller.locale, 'added', { seq, category, amount, note: noteText });
  }

  async deleteEntry(caller: LedgerCaller, seq: number): Promise<string> {
    await this.#rememberPrivate(caller);
    return this.#withUserLock(caller.ownerKey, async () => {
      const entry = await this.#store.findEntry(caller.ownerKey, seq);
      if (!entry) return t(caller.locale, 'notFound', { seq });
      await this.#store.deleteEntry(caller.ownerKey, seq);
      const amount = caller.isPrivate ? formatCents(entry.amountCents) : MASKED_AMOUNT;
      return t(caller.locale, 'deleted', { seq, category: entry.category, amount });
    });
  }

  async #entriesIn(ownerKey: string, period: LedgerPeriod): Promise<LedgerEntry[]> {
    const nowMs = this.#now();
    const entries = await this.#store.listEntries(ownerKey);
    return entries.filter((entry) => isInPeriod(entry.createdAt, nowMs, period, this.#config.timezone));
  }

  async periodSummary(caller: LedgerCaller, period: LedgerPeriod): Promise<string> {
    const entries = await this.#entriesIn(caller.ownerKey, period);
    const reply = formatPeriodSummary(summarize(entries, period, this.#now(), this.#config.timezone, caller.locale), caller.locale);
    return this.#deliver(caller, reply, t(caller.locale, 'spending', { period: periodLabel(period, caller.locale) }));
  }

  async categoryStatistics(caller: LedgerCaller, period: LedgerPeriod): Promise<string> {
    const entries = await this.#entriesIn(caller.ownerKey, period);
    const reply = formatCategoryStatistics(summarize(entries, period, this.#now(), this.#config.timezone, caller.locale), caller.locale);
    return this.#deliver(caller, reply, t(caller.locale, 'statistics'));
  }

  async listEntries(caller: LedgerCaller, period: LedgerPeriod): Promise<string> {
    const entries = await this.#entriesIn(caller.ownerKey, period);
    const reply = formatEntryList(entries, period, this.#now(), this.#config.timezone, caller.locale);
    return this.#deliver(caller, reply, t(caller.locale, 'entryList', { period: periodLabel(period, caller.locale) }));
  }

  /** Private chat: full reply. Group/channel: try a private message, else the masked reply. */
  async #deliver(caller: LedgerCaller, reply: LedgerReply, title: string): Promise<string> {
    if (caller.isPrivate) {
      await this.#rememberPrivate(caller);
      return reply.full;
    }
    if (reply.full === reply.masked) return reply.full;
    const delivered = await this.#sendPrivately(caller, reply.full);
    if (delivered) return t(caller.locale, 'privateSent', { title });
    return t(caller.locale, 'privateFallback', { text: reply.masked });
  }

  async #sendPrivately(caller: LedgerCaller, content: string): Promise<boolean> {
    const sendTarget = this.#outbound?.sendTarget;
    if (!sendTarget) return false;
    try {
      await sendTarget.call(this.#outbound, await this.#privateTargetOf(caller), content, { locale: resolveLocale(caller.locale) });
      return true;
    } catch (error) {
      logger.debug(`private delivery unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async dailyReport(caller: LedgerCaller, action: DailyReportAction, commandHead?: string): Promise<string> {
    await this.#rememberPrivate(caller);
    const hint = (action: 'on' | 'off') => commandHead ? t(caller.locale, 'commandHint', { command: `${commandHead} ${resolveLocale(caller.locale) === 'en' ? action : action === 'on' ? '开启' : '关闭'}` }) : '';
    const reportTime = this.#config.reportTime;
    const user = await this.#store.getUser(caller.ownerKey);
    if (action === 'status') {
      if (user?.reportEnabled) return t(caller.locale, 'reportEnabled', { time: reportTime, timezone: this.#config.timezone });
      return [t(caller.locale, 'reportDisabled'), hint('on')].filter(Boolean).join(' ');
    }
    if (action === 'off') {
      await this.#store.setReport(caller.ownerKey, false, undefined, user?.lastReportDate ?? '');
      return t(caller.locale, 'reportOff');
    }
    if (!this.#outbound?.sendTarget) return t(caller.locale, 'noPrivate');
    const confirmation = [t(caller.locale, 'reportOn', { time: reportTime, timezone: this.#config.timezone }), hint('off')].filter(Boolean).join(' ');
    if (!caller.isPrivate) {
      const reachable = await this.#sendPrivately(caller, confirmation);
      if (!reachable) return [t(caller.locale, 'cannotPrivate'), hint('on')].filter(Boolean).join(' ');
    }
    const nowMs = this.#now();
    const today = localDateKey(nowMs, this.#config.timezone);
    const alreadyPastReportTime = localTimeKey(nowMs, this.#config.timezone) >= reportTime;
    const lastReportDate = alreadyPastReportTime ? today : '';
    await this.#store.setReport(caller.ownerKey, true, await this.#privateTargetOf(caller), lastReportDate, resolveLocale(caller.locale));
    return caller.isPrivate ? confirmation : t(caller.locale, 'reportOnPrivate');
  }

  /**
   * Called every minute by the schedule. Once the local time reaches `reportTime`, each subscriber
   * who has not had today's report gets it in their private chat. A failed delivery is logged and
   * not retried that day, so an unreachable user is not messaged every minute.
   */
  async runDailyReports(): Promise<number> {
    const nowMs = this.#now();
    const timezone = this.#config.timezone;
    if (localTimeKey(nowMs, timezone) < this.#config.reportTime) return 0;
    const today = localDateKey(nowMs, timezone);
    const subscribers = await this.#store.listReportSubscribers();
    let sent = 0;
    for (const subscriber of subscribers) {
      if (subscriber.lastReportDate === today) continue;
      await this.#store.markReported(subscriber.ownerKey, today);
      if (!subscriber.reportTarget || !this.#outbound?.sendTarget) continue;
      const entries = await this.#entriesIn(subscriber.ownerKey, 'today');
      if (entries.length === 0 && !this.#config.reportWhenEmpty) continue;
      const summary = formatPeriodSummary(summarize(entries, 'today', nowMs, timezone, subscriber.reportLocale), subscriber.reportLocale);
      try {
        await this.#outbound.sendTarget(subscriber.reportTarget, t(subscriber.reportLocale, 'report', { text: summary.full }), { locale: resolveLocale(subscriber.reportLocale) });
        sent += 1;
      } catch (error) {
        logger.warn(`daily report delivery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return sent;
  }
}
