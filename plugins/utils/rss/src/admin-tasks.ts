import { adminText, taskDetail, formatTaskDetail, isAdminTextKey, LocalizedTaskError, type AdminTextKey } from './admin-i18n.js';
import { rssMessages as t } from './i18n.js';
import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { createHash, randomUUID } from 'node:crypto';
import { createDeliveryTarget, type DeliveryTarget, type OutboundHost, type PluginStateStore } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createGenerationAdmissionGate, generationAdmissionSource, PluginTaskError,
  type JsonValue, type PluginTask, type PluginTaskAction, type PluginTaskMutation,
  type PluginTaskProvider, type PluginTaskSnapshot } from 'zhin.js/plugin-runtime';
import { fetchFeed, stripHtml, type FeedItem, type RssConfig } from './feed.js';
import { formatNewItems } from './poll.js';
import { isRssQuietMinute, parseQuietHours, LocalizedQuietHoursError, type RssQuietHours } from './quiet-hours.js';

export const ADMIN_RSS_STATE_KEY = 'admin-rss/v1';
const MAX_TASKS = 8;
const MAX_RECEIPTS = 32;
const MAX_SEEN = 64;
const MAX_PENDING_ITEMS = 3;
const MAX_PENDING_COUNT = 10_000;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const DIGEST = /^[\da-f]{64}$/u;
type Task = {
  readonly id: string; readonly creation: string; readonly version: string; readonly url: string;
  readonly target: DeliveryTarget; readonly locale?: Locale; readonly createdAt: number;
  readonly state: 'scheduled' | 'paused' | 'unknown' | 'failed' | 'cancelled';
  readonly seen: readonly string[] | null; readonly claimId: string | null;
  readonly lastCheckAt: number | null; readonly lastRunAt: number | null; readonly detail: string; readonly detailKey?: AdminTextKey;
  readonly quiet?: RssQuietHours;
  readonly pending?: PendingSummary | null;
};
type SummaryItem = { readonly key: string; readonly title: string; readonly link: string };
type PendingSummary = { readonly from: number; readonly to: number; readonly count: number; readonly countCapped: boolean; readonly items: readonly SummaryItem[] };
type Receipt = { readonly id: string; readonly fingerprint: string; readonly taskId: string; readonly operation: 'create' | PluginTaskAction };
export type AdministratorRssBook = { readonly version: 1 | 2; readonly revision: string; readonly tasks: readonly Task[]; readonly receipts: readonly Receipt[] };
type FeedLoader = typeof fetchFeed;

/** Administrator subscriptions use their own owner-bound durable pool and per-task cursors. */
export class AdministratorRssTasks implements PluginTaskProvider {
  readonly i18n = {
  "en": {
    "title": "Administrator RSS subscriptions",
    "description": "Deliver new articles to an exact account, conversation and thread, independently of chat subscriptions.",
    "effects": [
      "Fetches the feed on the instance pollCron schedule. The first successful fetch after creation or resuming only establishes a baseline; historical articles are not sent.",
      "New articles use the unified send pipeline and the complete selected target. Pausing or cancelling cannot recall a delivery already in progress.",
      "Unconfirmed delivery is never retried or resumed automatically. Check the target conversation before cancelling and creating another subscription.",
      "Each instance supports 8 tasks and retains 32 operation receipts and 64 recent article identifiers. An article that disappears for a long time may be treated as new when it returns.",
      "Only administrator subscriptions with all three quiet-hours fields defer and summarize delivery. The first poll after quiet hours sends the pending summary; the next poll fetches the feed. Reminders and chat subscriptions are unaffected.",
      "A summary stores up to 3 short items, further limited by maxItems, and counts up to 10000 updates before showing “at least”. Pausing, editing or cancelling clears pending summaries; resuming establishes a new baseline without backfilling."
    ]
  }
} as const;
  readonly title = '管理员 RSS 订阅';
  readonly description = '向精确账号、会话与线程推送新文章，独立于聊天创建的 RSS 订阅';
  readonly schema = { type: 'object', additionalProperties: false, required: ['url'], properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048, 'x-i18n': {"en": {"title": "RSS / Atom URL", "description": "HTTP(S) URL without a username or password"}}, title: 'RSS / Atom 地址', description: 'HTTP(S) 地址，不接受 URL 用户名或密码' },
    quietTimezone: { type: 'string', maxLength: 128, 'x-i18n': {"en": {"title": "Quiet timezone (optional)", "description": "For example Asia/Shanghai. Fill in all three quiet-hours fields to enable, or leave all empty to disable."}}, title: '静默时区（可选）', description: '如 Asia/Shanghai；三项全部留空关闭静默，启用须全部填写' },
    quietStart: { type: 'string', maxLength: 5, 'x-i18n': {"en": {"title": "Quiet start (optional)", "description": "HH:mm, inclusive, such as 22:00. Timezone and end time are also required."}}, title: '静默开始（可选）', description: 'HH:mm，包含此分钟，如 22:00；须同时填写时区和结束时间' },
    quietEnd: { type: 'string', maxLength: 5, 'x-i18n': {"en": {"title": "Quiet end (optional)", "description": "HH:mm, exclusive, such as 08:00. Start and end must be different."}}, title: '静默结束（可选）', description: 'HH:mm，不包含此分钟，如 08:00；开始和结束不能相同' },
  } } as const;
  readonly effects = [
    '保存后按实例 pollCron 定时访问源站；新建及暂停后恢复的首次成功抓取只建立基线，不发送历史文章',
    '后续新文章经统一发送链投递到所选完整目标；暂停或取消不能撤回已开始的投递',
    '未确认的投递不会自动重试或恢复；需核实目标会话后取消并另建订阅',
    '每实例最多 8 条任务，操作回执保留最近 32 条；订阅仅保留最近 64 个条目标识，长期移除后重新出现的文章可能再次视为新内容',
    '仅显式填写三项静默配置的管理员订阅延后汇总；退出静默后的首轮轮询先发已积累摘要，该订阅下一轮再抓源；不改变定时提醒或聊天订阅',
    '摘要最多保留 3 条短明细，展示仍受实例 maxItems 限制；计数最多 10000 条，超过时以“至少”说明；暂停、编辑和取消清空待发摘要，恢复重新建基线、不补发',
  ];
  readonly #state: PluginStateStore;
  readonly #outbound: OutboundHost;
  readonly #config: Readonly<RssConfig>;
  readonly #load: FeedLoader;
  readonly projectLocale: Locale;
  readonly #admission = createGenerationAdmissionGate();
  #stopped = false;
  #working = false;
  get [generationAdmissionSource]() { return [this.#admission]; }

  constructor(state: PluginStateStore, outbound: OutboundHost, config: Readonly<RssConfig>, load: FeedLoader = fetchFeed, projectLocale: Locale = 'zh-CN') {
    if (!outbound.sendTarget) throw unavailable('exactTarget');
    this.projectLocale = projectLocale; this.#state = state; this.#outbound = outbound; this.#config = config; this.#load = load;
  }
  stop(): void { this.#stopped = true; }

  async read(options?: { readonly locale?: Locale }): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => this.#snapshot(readBook(await this.#state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY)), options?.locale), options?.locale);
  }
  async create(input: PluginTaskMutation & Readonly<{ target: DeliveryTarget; parameters: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => {
      assertMutation(input);
      let target: DeliveryTarget;
      try { target = createDeliveryTarget({ conversation: input.target }); } catch { throw invalid('invalidTarget'); }
      const parameters = parseParameters(input.parameters), { url, quiet } = parameters;
      const fingerprint = digest({ operation: 'create', target, url, ...(quiet ? { quiet } : {}) });
      const task: Task = { id: input.requestId, creation: fingerprint, version: randomUUID(), url, target, locale: this.projectLocale, createdAt: Date.now(), state: 'scheduled',
        seen: null, claimId: null, lastCheckAt: null, lastRunAt: null, ...taskDetail('waiting'), ...(quiet ? { quiet, pending: null } : {}) };
      const revision = randomUUID();
      const book = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
        this.#assertLive(); const book = readBook(current);
        if (reconcile(book, input.requestId, fingerprint)) return book;
        assertRevision(book, input.expectedRevision);
        const existing = book.tasks.find(item => item.id === task.id);
        if (existing) { if (existing.creation !== fingerprint) throw conflict('requestReused'); return book; }
        const active = book.tasks.filter(item => item.state !== 'cancelled' && item.state !== 'failed');
        if (active.length >= MAX_TASKS) throw invalid('quota');
        if (active.some(item => item.url === url && JSON.stringify(item.target) === JSON.stringify(target))) throw invalid('duplicate');
        const historyLimit = MAX_TASKS - active.length - 1;
        const history = historyLimit ? book.tasks.filter(item => item.state === 'cancelled' || item.state === 'failed').slice(-historyLimit) : [];
        return bounded({ version: 2, revision, tasks: [...active, ...history, task], receipts: receipt(book, input.requestId, fingerprint, task.id, 'create') });
      });
      return this.#snapshot(readBook(book), input.locale);
    }, input.locale);
  }
  async change(input: PluginTaskMutation & Readonly<{ id: string; action: PluginTaskAction; parameters?: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => {
      assertMutation(input);
      if (!isUuid(input.id) || !['pause', 'resume', 'cancel', 'update'].includes(input.action)) throw invalid('invalidAction');
      if (input.action !== 'update' && input.parameters !== undefined) throw invalid('updateParameters');
      const parameters = input.action === 'update' ? parseParameters(input.parameters) : undefined;
      const url = parameters?.url;
      const fingerprint = digest({ operation: input.action, id: input.id, url: url ?? null, ...(parameters?.quiet ? { quiet: parameters.quiet } : {}) }), revision = randomUUID(), version = randomUUID();
      const result = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
        this.#assertLive(); const book = readBook(current);
        if (reconcile(book, input.requestId, fingerprint)) return book;
        assertRevision(book, input.expectedRevision);
        const task = book.tasks.find(item => item.id === input.id);
        if (!task) throw new LocalizedTaskError('not_found', 'notFound');
        let changed: Task;
        switch (input.action) {
          case 'pause':
            if (task.state !== 'scheduled') throw invalid('pauseState');
            changed = { ...task, version, state: 'paused', pending: null, ...taskDetail('paused') }; break;
          case 'resume':
            if (task.state !== 'paused') throw invalid('resumeState');
            changed = { ...task, version, state: 'scheduled', seen: null, pending: null, ...taskDetail('resumed') }; break;
          case 'update':
            if (task.state !== 'paused') throw invalid('updateState');
            if (book.tasks.some(item => item.id !== task.id && item.state !== 'cancelled' && item.state !== 'failed' && item.url === url
              && JSON.stringify(item.target) === JSON.stringify(task.target))) throw invalid('duplicateUpdate');
            changed = { ...withoutQuiet(task), version, url: url!, ...(parameters?.quiet ? { quiet: parameters.quiet } : {}), pending: null, seen: null, ...taskDetail('edited') }; break;
          case 'cancel':
            if (task.state === 'cancelled' || task.state === 'failed') throw invalid('finished');
            changed = { ...task, version, state: 'cancelled', pending: null, ...taskDetail('cancelled') }; break;
        }
        return bounded({ ...book, version: 2, revision, tasks: book.tasks.map(item => item.id === task.id ? changed : item), receipts: receipt(book, input.requestId, fingerprint, task.id, input.action) });
      });
      return this.#snapshot(readBook(result), input.locale);
    }, input.locale);
  }

  /** Called by the plugin's one existing RSS poll registration, never by chat rss-check. */
  async tick(): Promise<void> {
    if (this.#stopped || this.#working) return;
    this.#working = true;
    try {
      await this.#admit(async () => {
        const queued = readBook(await this.#state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY)).tasks;
        const flushed = new Set<string>();
        // Drain durable summaries before touching any source. A broken or slow feed
        // cannot block an already-observed summary, including other subscriptions.
        for (const task of queued) {
          if (this.#stopped) break;
          if (task.state !== 'scheduled' || !task.quiet || !task.pending || isRssQuietMinute(task.quiet, Date.now())) continue;
          const claimed = await this.#claimPending(task);
          if (claimed) { flushed.add(task.id); await this.#deliver(claimed, formatSummary(claimed.url, claimed.pending!, this.#config.maxItems, resolveLocale(claimed.locale))); }
        }
        const tasks = readBook(await this.#state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY)).tasks;
        for (const task of tasks) {
          if (this.#stopped) break;
          if (task.state !== 'scheduled' || flushed.has(task.id)) continue;
          let feed: Awaited<ReturnType<FeedLoader>>;
          try { feed = await this.#load(task.url, this.#config.timeout); }
          catch { await this.#recordCheck(task, 'fetchFailed'); continue; }
          if (this.#stopped) break;
          // Keep only bounded identifiers, never arbitrary feed bodies, in durable state.
          const unique = new Map<string, FeedItem>();
          for (const item of feed.items.slice(0, 20)) if (item.guid) unique.set(digest(item.guid), item);
          const newItems = task.seen === null ? [] : [...unique].filter(([key]) => !task.seen!.includes(key)).map(([, item]) => item);
          const seen = [...new Set([...unique.keys(), ...(task.seen ?? [])])].slice(0, MAX_SEEN);
          const claimId = randomUUID(), version = randomUUID(), revision = randomUUID(), now = Date.now();
          const quiet = task.quiet !== undefined && isRssQuietMinute(task.quiet, now);
          const pending = task.quiet && (quiet || task.pending) ? appendSummary(task.pending, newItems, now) : null;
          const shouldSend = !quiet && (newItems.length > 0 || pending !== null);
          const result = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
            const book = readBook(current);
            const live = book.tasks.find(item => item.id === task.id);
            if (this.#stopped || live?.version !== task.version || live.state !== 'scheduled') return current;
            const changed: Task = { ...live, seen, version, lastCheckAt: now, pending, ...(shouldSend
              ? { state: 'unknown', claimId, lastRunAt: now, ...taskDetail('delivering') }
              : taskDetail(pending ? 'quietPending' : task.seen === null ? 'baseline' : 'noNew')) };
            return bounded({ ...book, version: 2, revision, tasks: book.tasks.map(item => item.id === task.id ? changed : item) });
          });
          const claimed = readBook(result).tasks.find(item => item.id === task.id && item.claimId === claimId && item.state === 'unknown');
          if (!claimed || this.#stopped) continue;
          await this.#deliver(claimed, claimed.pending ? formatSummary(claimed.url, claimed.pending, this.#config.maxItems, resolveLocale(claimed.locale))
            : formatNewItems(feed.title || claimed.url, newItems, this.#config.maxItems, resolveLocale(claimed.locale)));
        }
      });
    } finally { this.#working = false; }
  }
  async #claimPending(task: Task): Promise<Task | undefined> {
    const claimId = randomUUID(), version = randomUUID(), revision = randomUUID(), now = Date.now();
    const result = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
      const book = readBook(current), live = book.tasks.find(item => item.id === task.id);
      if (this.#stopped || !live || live.version !== task.version || live.state !== 'scheduled' || !live.pending || !live.quiet || isRssQuietMinute(live.quiet, now)) return current;
      return bounded({ ...book, version: 2, revision, tasks: book.tasks.map(item => item.id === task.id
        ? { ...item, version, claimId, lastRunAt: now, state: 'unknown', ...taskDetail('summaryDelivering') } : item) });
    });
    return readBook(result).tasks.find(item => item.id === task.id && item.claimId === claimId && item.state === 'unknown');
  }
  async #deliver(claimed: Task, content: string): Promise<void> {
    if (this.#stopped) return;
    let state: Task['state'] = 'unknown', detail = taskDetail('unknown');
    try {
      const id = await this.#outbound.sendTarget!(claimed.target, content);
      if (id) { state = 'scheduled'; detail = taskDetail('delivered'); }
    } catch (error) {
      if (error instanceof EndpointDeliveryError && error.disposition !== 'unknown') { state = 'failed'; detail = taskDetail('rejected'); }
    }
    const revision = randomUUID(), version = randomUUID();
    await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
      const book = readBook(current), live = book.tasks.find(item => item.id === claimed.id);
      if (live?.claimId !== claimed.claimId || live.state !== 'unknown') return current;
      return bounded({ ...book, version: 2, revision, tasks: book.tasks.map(item => item.id === claimed.id
        ? { ...item, state, ...detail, version, ...(state === 'scheduled' ? { pending: null } : {}) } : item) });
    });
  }
  async #recordCheck(task: Task, detailKey: AdminTextKey): Promise<void> {
    if (this.#stopped) return;
    const revision = randomUUID(), version = randomUUID(), now = Date.now();
    await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
      const book = readBook(current);
      if (this.#stopped || !book.tasks.some(item => item.id === task.id && item.version === task.version && item.state === 'scheduled')) return current;
      return bounded({ ...book, version: 2, revision, tasks: book.tasks.map(item => item.id === task.id ? { ...item, version, ...taskDetail(detailKey), lastCheckAt: now } : item) });
    });
  }
  #assertLive(): void { if (this.#stopped) throw unavailable('stopped'); }
  async #admit<T>(operation: () => Promise<T>, locale?: Locale): Promise<T> {
    let release: (() => void) | undefined;
    try {
    this.#assertLive(); release = this.#admission.acquire();
    if (!release) throw unavailable('retired');
    return await operation();
    } catch (error) { throw error instanceof LocalizedTaskError ? error.localize(locale) : error; } finally { release?.(); }
  }
  #snapshot(book: AdministratorRssBook, locale?: Locale): PluginTaskSnapshot {
    return { revision: book.revision, receipts: book.receipts.map(item => ({ requestId: item.id, taskId: item.taskId, operation: item.operation })),
      tasks: book.tasks.map(task => ({ id: task.id, ownership: 'administrator', title: `RSS · ${task.url}`.slice(0, 200), target: task.target,
        state: task.state, createdAt: task.createdAt, ...(task.lastRunAt === null ? {} : { lastRunAt: task.lastRunAt }), parameters: { url: task.url,
          ...(task.quiet ? { quietTimezone: task.quiet.timezone, quietStart: task.quiet.start, quietEnd: task.quiet.end } : {}) },
        detail: [formatTaskDetail(task, locale), task.quiet ? adminText(locale, 'quietDescription', task.quiet) : '',
          task.pending ? adminText(locale, task.state === 'scheduled' ? 'pendingDescription' : 'summaryDescription', { count: task.pending.countCapped ? adminText(locale, 'countCapped', { count: task.pending.count }) : task.pending.count }) : '',
          adminText(locale, 'pollDescription', { cron: this.#config.pollCron }), task.lastCheckAt === null ? '' : adminText(locale, 'checkedDescription', { at: new Date(task.lastCheckAt).toISOString() }), adminText(locale, 'stateNote')].filter(Boolean).join(locale === 'en' ? '; ' : '；'),
        actions: task.state === 'scheduled' ? ['pause', 'cancel'] : task.state === 'paused' ? ['update', 'resume', 'cancel'] : task.state === 'unknown' ? ['cancel'] : [],
      })) };
  }
}

function parseParameters(value: Readonly<Record<string, JsonValue>> | undefined): { url: string; quiet?: RssQuietHours } {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !['url', 'quietTimezone', 'quietStart', 'quietEnd'].includes(key))
    || typeof value.url !== 'string' || value.url.length > 2048) throw invalid('invalidParameters');
  let quiet: RssQuietHours | undefined;
  try { quiet = parseQuietHours(value); }
  catch (error) { if (error instanceof LocalizedQuietHoursError) throw invalid(error.messageKey); throw invalid('invalidQuiet'); }
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/u.test(value.url)) throw new Error('url');
    url.hash = '';
    if (url.href.length > 2048) throw new Error('url length');
    return { url: url.href, ...(quiet ? { quiet } : {}) };
  } catch { throw invalid('invalidUrl'); }
}
function assertMutation(input: PluginTaskMutation): void {
  if (!isUuid(input.requestId) || typeof input.expectedRevision !== 'string'
    || !input.expectedRevision || input.expectedRevision.length > 128) throw invalid('invalidMutation');
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function isDigest(value: unknown): value is string { return typeof value === 'string' && DIGEST.test(value); }
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}
function invalid(message: AdminTextKey): PluginTaskError { return new LocalizedTaskError('invalid_input', message); }
function conflict(message: AdminTextKey): PluginTaskError { return new LocalizedTaskError('conflict', message); }
function unavailable(message: AdminTextKey): PluginTaskError { return new LocalizedTaskError('unavailable', message); }
function assertRevision(book: AdministratorRssBook, revision: string): void { if (book.revision !== revision) throw conflict('revision'); }
function reconcile(book: AdministratorRssBook, id: string, fingerprint: string): boolean {
  const previous = book.receipts.find(item => item.id === id);
  if (!previous) return false;
  if (previous.fingerprint !== fingerprint) throw conflict('replayConflict');
  return true;
}
function receipt(book: AdministratorRssBook, id: string, fingerprint: string, taskId: string, operation: Receipt['operation']): readonly Receipt[] {
  return [...book.receipts, { id, fingerprint, taskId, operation }].slice(-MAX_RECEIPTS);
}
function bounded(book: AdministratorRssBook): AdministratorRssBook {
  if (book.tasks.length > MAX_TASKS || bytes(book) > 60 * 1024) throw invalid('capacity');
  // Reserve future bounded cursors, summary samples and claim metadata at mutation
  // time. Once accepted, ordinary quiet accumulation cannot exceed the state port.
  const reserved = { ...book, revision: 'f'.repeat(36), tasks: book.tasks.map(task => !task.quiet || task.state === 'cancelled' || task.state === 'failed' ? task : {
    ...task, seen: Array.from({ length: MAX_SEEN }, () => 'f'.repeat(64)), claimId: 'f'.repeat(36),
    lastCheckAt: 8_640_000_000_000_000, lastRunAt: 8_640_000_000_000_000,
    detail: bytes(task.detail) >= 514 ? task.detail : 'x'.repeat(512),
    pending: { from: 8_640_000_000_000_000, to: 8_640_000_000_000_000, count: MAX_PENDING_COUNT, countCapped: false,
      items: Array.from({ length: MAX_PENDING_ITEMS }, () => ({ key: 'f'.repeat(64), title: 'x'.repeat(128), link: 'x'.repeat(384) })) },
  }) };
  if (bytes(reserved) > 60 * 1024) throw invalid('capacityReserved');
  return book;
}
function readBook(value: AdministratorRssBook | undefined): AdministratorRssBook {
  if (value === undefined) return { version: 1, revision: '0', tasks: [], receipts: [] };
  try {
    if (!value || ![1, 2].includes(value.version) || (value.revision !== '0' && !isUuid(value.revision))
      || !Array.isArray(value.tasks) || !Array.isArray(value.receipts) || value.receipts.length > MAX_RECEIPTS) throw new Error('book');
    const ids = new Set<string>(), requests = new Set<string>();
    for (const item of value.receipts) {
      if (!item || !isUuid(item.id) || requests.has(item.id) || !isUuid(item.taskId) || !isDigest(item.fingerprint)
        || !['create', 'pause', 'resume', 'cancel', 'update'].includes(item.operation)) throw new Error('receipt');
      requests.add(item.id);
    }
    for (const task of value.tasks) {
      if (!task || !isUuid(task.id) || ids.has(task.id) || !isUuid(task.version) || !isDigest(task.creation)
        || !isTimestamp(task.createdAt) || !['scheduled', 'paused', 'unknown', 'failed', 'cancelled'].includes(task.state)
        || (task.lastCheckAt !== null && !isTimestamp(task.lastCheckAt))
        || (task.lastRunAt !== null && !isTimestamp(task.lastRunAt))
        || (task.claimId !== null && !isUuid(task.claimId)) || (task.state === 'unknown' && (!task.claimId || task.seen === null || task.lastRunAt === null))
        || (task.seen !== null && (!Array.isArray(task.seen) || task.seen.length > MAX_SEEN || !task.seen.every((key: unknown) => typeof key === 'string' && DIGEST.test(key))))
        || (task.locale !== undefined && task.locale !== 'zh-CN' && task.locale !== 'en') || (task.detailKey !== undefined && !isAdminTextKey(task.detailKey))
        || typeof task.detail !== 'string' || task.detail.length > 1000 || parseParameters({ url: task.url }).url !== task.url) throw new Error('task');
      if (task.quiet !== undefined) {
        if (value.version !== 2 || !task.quiet || Object.keys(task.quiet).sort().join(',') !== 'end,start,timezone'
          || JSON.stringify(parseQuietHours({ quietTimezone: task.quiet.timezone, quietStart: task.quiet.start, quietEnd: task.quiet.end })) !== JSON.stringify(task.quiet)) throw new Error('quiet');
      }
      if (task.pending != null) {
        const pending = task.pending;
        if (!task.quiet || task.seen === null || task.state === 'paused' || task.state === 'cancelled'
          || Object.keys(pending).sort().join(',') !== 'count,countCapped,from,items,to'
          || !isTimestamp(pending.from) || !isTimestamp(pending.to) || pending.to < pending.from
          || !Number.isSafeInteger(pending.count) || pending.count < 1 || pending.count > MAX_PENDING_COUNT
          || typeof pending.countCapped !== 'boolean' || (pending.countCapped && pending.count !== MAX_PENDING_COUNT)
          || !Array.isArray(pending.items) || pending.items.length > MAX_PENDING_ITEMS || pending.items.length > pending.count
          || new Set(pending.items.map((item: SummaryItem) => item.key)).size !== pending.items.length
          || pending.items.some((item: SummaryItem) => !item || Object.keys(item).sort().join(',') !== 'key,link,title'
            || !isDigest(item.key) || typeof item.title !== 'string' || bytes(item.title) > 128
            || typeof item.link !== 'string' || bytes(item.link) > 384 || (item.link !== '' && shortLink(item.link) !== item.link))) throw new Error('pending');
      }
      const target = createDeliveryTarget({ conversation: task.target });
      if (JSON.stringify(target) !== JSON.stringify(task.target)) throw new Error('target');
      ids.add(task.id);
    }
    return bounded(value);
  } catch { throw unavailable('corrupt'); }
}

function withoutQuiet(task: Task): Omit<Task, 'quiet'> { const { quiet: _quiet, ...rest } = task; return rest; }
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function appendSummary(previous: PendingSummary | null | undefined, items: readonly FeedItem[], now: number): PendingSummary | null {
  if (!previous && items.length === 0) return null;
  const samples = [...(previous?.items ?? [])];
  for (const item of items) {
    if (samples.length >= MAX_PENDING_ITEMS) break;
    const key = digest(item.guid);
    if (!samples.some(sample => sample.key === key)) samples.push({ key, title: shortTitle(item.title), link: shortLink(item.link) });
  }
  const count = (previous?.count ?? 0) + items.length;
  return { from: Math.min(previous?.from ?? now, now), to: Math.max(previous?.to ?? now, now), count: Math.min(count, MAX_PENDING_COUNT),
    countCapped: previous?.countCapped === true || count > MAX_PENDING_COUNT, items: samples };
}
function shortTitle(value: string): string {
  let title = '';
  for (const original of stripHtml(value.slice(0, 2048))) {
    const code = original.codePointAt(0)!;
    const character = code < 32 || code === 127 ? ' ' : original;
    if (bytes(title + character) > 128) break;
    title += character;
  }
  return title.trim();
}
function shortLink(value: string): string {
  if (!value || value.length > 384) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && bytes(url.href) <= 384 ? url.href : '';
  } catch { return ''; }
}
function formatSummary(url: string, pending: PendingSummary, maxItems: number, locale: Locale = 'zh-CN'): string {
  const lines = [t(locale, 'summaryHeading', { minimum: pending.countCapped ? t(locale, 'atLeast') : '', count: pending.count }), t(locale, 'source', { url })];
  const shown = pending.items.slice(0, Math.min(MAX_PENDING_ITEMS, maxItems));
  for (const item of shown) lines.push('', item.title || t(locale, 'untitled'), ...(item.link ? [item.link] : []));
  if (pending.count > shown.length || pending.countCapped) lines.push('', t(locale, 'summaryMore', { count: shown.length }));
  return lines.join('\n');
}
