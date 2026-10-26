import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages } from './i18n.js';
/**
 * Conservative live / dynamic watcher.
 *
 * - One poll per schedule tick (default every 60s) after a random jitter.
 * - Live status is fetched in one batched request for all watched UPs.
 * - Dynamics are fetched per UP with a gap between requests.
 * - Failures back off exponentially per source (live batch or one UP);
 *   risk-control responses back off harder. Nothing throws to the scheduler.
 * - The first observation of an UP only records a baseline, so restarts and
 *   new subscriptions never flood a conversation with old items.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { BiliApiError, type BiliClient, type DynamicItem, type LiveInfo } from './api.js';
import type { ResolvedBilibiliConfig } from './config.js';
import { formatDynamic, formatLiveStart } from './format.js';
import type { BiliOutboundPush } from './runtime.js';
import {
  emptyState,
  getBiliState,
  getBiliSubs,
  loadState,
  saveState,
  wantsDynamic,
  wantsLive,
  type BiliDb,
  type BiliRow,
  type WatchState,
} from './store.js';

/** At most this many new dynamics per UP are pushed in one tick. */
export const MAX_DYNAMICS_PER_TICK = 3;
/** Dynamics older than this are recorded as seen but never pushed. */
export const MAX_DYNAMIC_AGE_SECONDS = 6 * 60 * 60;

export interface WatcherOptions {
  readonly db: BiliDb;
  readonly config: Readonly<ResolvedBilibiliConfig>;
  readonly client: BiliClient;
  readonly outbound: BiliOutboundPush | null;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

export interface TickResult {
  readonly skipped?: 'busy' | 'aborted';
  readonly liveChecked: number;
  readonly dynamicsChecked: number;
  readonly pushed: number;
  readonly errors: readonly string[];
}

interface Backoff {
  failures: number;
  until: number;
  reason: string;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, signal ? { signal } : undefined);
  } catch {
    // Aborted: the caller checks the signal.
  }
}

export class BilibiliWatcher {
  readonly #options: WatcherOptions;
  readonly #backoff = new Map<string, Backoff>();
  #running = false;
  lastError: { readonly at: number; readonly message: string } | undefined;
  lastSuccessAt: number | undefined;

  constructor(options: WatcherOptions) {
    this.#options = options;
  }

  get #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #sleep(ms: number): Promise<void> {
    return (this.#options.sleep ?? defaultSleep)(ms, this.#options.signal);
  }

  #aborted(): boolean {
    return this.#options.signal?.aborted === true;
  }

  #blocked(key: string): boolean {
    const entry = this.#backoff.get(key);
    return entry !== undefined && entry.until > this.#now;
  }

  #fail(key: string, error: unknown): string {
    const previous = this.#backoff.get(key);
    const risk = error instanceof BiliApiError && error.kind === 'risk';
    const failures = (previous?.failures ?? 0) + (risk ? 2 : 1);
    const minutes = Math.min(this.#options.config.maxBackoffMinutes, 2 ** Math.min(failures - 1, 10));
    const message = error instanceof Error ? error.message : String(error);
    this.#backoff.set(key, { failures, until: this.#now + minutes * 60_000, reason: message });
    this.lastError = { at: this.#now, message: `${key}: ${message}` };
    (this.#options.warn ?? console.warn)(`[bilibili] ${key} 请求失败，${minutes} 分钟后重试：${message}`);
    return `${key}: ${message}`;
  }

  #ok(key: string): void {
    this.#backoff.delete(key);
  }

  /** Drop per-UP state once nobody subscribes to that UP any more. */
  forget(uid: string): void {
    this.#backoff.delete(`dynamic:${uid}`);
  }

  /** Human readable list of sources currently backing off. */
  backoffStatus(locale: Locale = 'zh-CN'): string[] {
    const now = this.#now;
    return [...this.#backoff.entries()]
      .filter(([, entry]) => entry.until > now)
      .map(([key, entry]) => messages(locale, 'backoff', {key, minutes: Math.ceil((entry.until - now) / 60_000), reason: entry.reason}));
  }

  async #push(rows: readonly BiliRow[], content: (locale: Locale) => string): Promise<number> {
    const push = this.#options.outbound;
    if (!push) return 0;
    let pushed = 0;
    for (const row of rows) {
      const { adapter_name: adapterName, endpoint_id: endpointKey, channel_type: channelType, channel_id: channelId } = row;
      if (typeof adapterName !== 'string' || !adapterName || typeof endpointKey !== 'string' || !endpointKey
        || typeof channelId !== 'string' || !channelId
        || (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel')) continue;
      try {
        await push({ adapterName, endpointKey, channelType, channelId, content: content(resolveLocale(row.locale)) });
        pushed += 1;
      } catch {
        // OutboundHost already logs; keep delivering to other subscribers.
      }
    }
    return pushed;
  }

  /** Record the current live / dynamic position of one UP without pushing. */
  async baseline(uid: string): Promise<void> {
    const State = getBiliState(this.#options.db);
    if (!State) return;
    const state = (await loadState(State, uid)) ?? emptyState(uid);
    const { config, client } = this.#options;
    if (config.live) {
      try {
        const info = (await client.getLiveStatus([uid])).get(uid);
        if (info) {
          state.liveStatus = info.liveStatus;
          state.liveTime = info.liveTime;
        }
      } catch { /* the next tick records the baseline */ }
    }
    if (config.dynamic && !state.dynamicReady) {
      try {
        const items = await client.getDynamics(uid);
        if (items.length > 0) markBaseline(state, items);
      } catch { /* the next tick records the baseline */ }
    }
    await saveState(State, state);
  }

  async tick(): Promise<TickResult> {
    if (this.#running) return { skipped: 'busy', liveChecked: 0, dynamicsChecked: 0, pushed: 0, errors: [] };
    this.#running = true;
    try {
      return await this.#tick();
    } finally {
      this.#running = false;
    }
  }

  async #tick(): Promise<TickResult> {
    const { db, config, client } = this.#options;
    const Subs = getBiliSubs(db);
    const State = getBiliState(db);
    const errors: string[] = [];
    let pushed = 0;
    let liveChecked = 0;
    let dynamicsChecked = 0;
    if (!Subs || !State) return { liveChecked, dynamicsChecked, pushed, errors: ['数据库尚未就绪'] };

    const rows = await Subs.select();
    if (rows.length === 0) return { liveChecked, dynamicsChecked, pushed, errors };
    const byUid = new Map<string, BiliRow[]>();
    for (const row of rows) {
      if (typeof row.uid !== 'string' || !row.uid) continue;
      const list = byUid.get(row.uid) ?? [];
      list.push(row);
      byUid.set(row.uid, list);
    }

    if (config.jitterMs > 0) await this.#sleep(Math.floor((this.#options.random ?? Math.random)() * config.jitterMs));
    if (this.#aborted()) return { skipped: 'aborted', liveChecked, dynamicsChecked, pushed, errors };

    if (config.live) {
      const liveUids = [...byUid.entries()].filter(([, subs]) => subs.some((s) => wantsLive(s.kinds))).map(([uid]) => uid);
      if (liveUids.length > 0 && !this.#blocked('live')) {
        try {
          const statuses = await client.getLiveStatus(liveUids);
          this.#ok('live');
          for (const uid of liveUids) {
            const info = statuses.get(uid);
            if (!info) continue;
            liveChecked += 1;
            const state = (await loadState(State, uid)) ?? emptyState(uid);
            if (shouldPushLive(state, info)) {
              pushed += await this.#push(byUid.get(uid)!.filter((s) => wantsLive(s.kinds)), locale => formatLiveStart(info, locale));
            }
            if (state.liveStatus !== info.liveStatus || state.liveTime !== info.liveTime) {
              state.liveStatus = info.liveStatus;
              state.liveTime = info.liveTime;
              await saveState(State, state);
            }
          }
        } catch (error) {
          errors.push(this.#fail('live', error));
        }
      }
    }

    if (config.dynamic) {
      let first = true;
      for (const [uid, subs] of byUid) {
        const targets = subs.filter((s) => wantsDynamic(s.kinds));
        const key = `dynamic:${uid}`;
        if (targets.length === 0 || this.#blocked(key)) continue;
        if (!first && config.requestGapMs > 0) await this.#sleep(config.requestGapMs);
        first = false;
        if (this.#aborted()) return { skipped: 'aborted', liveChecked, dynamicsChecked, pushed, errors };
        try {
          const items = await client.getDynamics(uid);
          this.#ok(key);
          dynamicsChecked += 1;
          const state = (await loadState(State, uid)) ?? emptyState(uid);
          // An empty feed is also what a soft risk-control block looks like:
          // never treat it as a baseline, or the next real answer would flood.
          if (items.length === 0) continue;
          if (!state.dynamicReady) {
            markBaseline(state, items);
          } else {
            const fresh = selectFreshDynamics(state, items);
            const uname = typeof subs[0]?.uname === 'string' ? subs[0].uname : uid;
            const recent = fresh.filter((item) => item.pubTs >= Math.floor(this.#now / 1000) - MAX_DYNAMIC_AGE_SECONDS);
            for (const item of recent.slice(-MAX_DYNAMICS_PER_TICK)) {
              pushed += await this.#push(targets, locale => formatDynamic(uname, item, locale));
            }
            for (const item of fresh) {
              state.seenDynamics.push(item.id);
              state.lastDynamicTs = Math.max(state.lastDynamicTs, item.pubTs);
            }
            if (fresh.length === 0) continue;
          }
          await saveState(State, state);
        } catch (error) {
          errors.push(this.#fail(key, error));
          // A risk-control answer applies to the whole client; stop this round.
          if (error instanceof BiliApiError && error.kind === 'risk') break;
        }
      }
    }
    if (errors.length === 0) this.lastSuccessAt = this.#now;
    return { liveChecked, dynamicsChecked, pushed, errors };
  }
}

/** Live start = known previous state, now live, and either was offline or a new session began. */
export function shouldPushLive(state: WatchState, info: LiveInfo): boolean {
  if (info.liveStatus !== 1 || state.liveStatus === -1) return false;
  if (state.liveStatus !== 1) return true;
  return info.liveTime > 0 && state.liveTime > 0 && info.liveTime !== state.liveTime;
}

export function markBaseline(state: WatchState, items: readonly DynamicItem[]): void {
  for (const item of items) {
    if (!state.seenDynamics.includes(item.id)) state.seenDynamics.push(item.id);
    state.lastDynamicTs = Math.max(state.lastDynamicTs, item.pubTs);
  }
  state.dynamicReady = true;
}

/** New, unseen, timestamped items newer than the cursor, oldest first. */
export function selectFreshDynamics(state: WatchState, items: readonly DynamicItem[]): DynamicItem[] {
  const seen = new Set(state.seenDynamics);
  return items
    .filter((item) => item.pubTs > 0 && item.pubTs > state.lastDynamicTs && !seen.has(item.id))
    .sort((a, b) => a.pubTs - b.pubTs);
}
