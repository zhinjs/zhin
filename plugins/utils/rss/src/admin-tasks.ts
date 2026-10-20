import { createHash, randomUUID } from 'node:crypto';
import { createDeliveryTarget, type DeliveryTarget, type OutboundHost, type PluginStateStore } from 'zhin.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createGenerationAdmissionGate, generationAdmissionSource, PluginTaskError,
  type JsonValue, type PluginTask, type PluginTaskAction, type PluginTaskMutation,
  type PluginTaskProvider, type PluginTaskSnapshot } from 'zhin.js/plugin-runtime';
import { fetchFeed, type FeedItem, type RssConfig } from './feed.js';
import { formatNewItems } from './poll.js';

export const ADMIN_RSS_STATE_KEY = 'admin-rss/v1';
const MAX_TASKS = 8;
const MAX_RECEIPTS = 32;
const MAX_SEEN = 64;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const DIGEST = /^[\da-f]{64}$/u;
type Task = {
  readonly id: string; readonly creation: string; readonly version: string; readonly url: string;
  readonly target: DeliveryTarget; readonly createdAt: number;
  readonly state: 'scheduled' | 'paused' | 'unknown' | 'failed' | 'cancelled';
  readonly seen: readonly string[] | null; readonly claimId: string | null;
  readonly lastCheckAt: number | null; readonly lastRunAt: number | null; readonly detail: string;
};
type Receipt = { readonly id: string; readonly fingerprint: string; readonly taskId: string; readonly operation: 'create' | PluginTaskAction };
export type AdministratorRssBook = { readonly version: 1; readonly revision: string; readonly tasks: readonly Task[]; readonly receipts: readonly Receipt[] };
type FeedLoader = typeof fetchFeed;

/** Administrator subscriptions use their own owner-bound durable pool and per-task cursors. */
export class AdministratorRssTasks implements PluginTaskProvider {
  readonly title = '管理员 RSS 订阅';
  readonly description = '向精确账号、会话与线程推送新文章，独立于聊天创建的 RSS 订阅';
  readonly schema = { type: 'object', additionalProperties: false, required: ['url'], properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048, title: 'RSS / Atom 地址', description: 'HTTP(S) 地址，不接受 URL 用户名或密码' },
  } } as const;
  readonly effects = [
    '保存后按实例 pollCron 定时访问源站；新建及暂停后恢复的首次成功抓取只建立基线，不发送历史文章',
    '后续新文章经统一发送链投递到所选完整目标；暂停或取消不能撤回已开始的投递',
    '未确认的投递不会自动重试或恢复；需核实目标会话后取消并另建订阅',
    '每实例最多 8 条任务，操作回执保留最近 32 条；订阅仅保留最近 64 个条目标识，长期移除后重新出现的文章可能再次视为新内容',
  ];
  readonly #state: PluginStateStore;
  readonly #outbound: OutboundHost;
  readonly #config: Readonly<RssConfig>;
  readonly #load: FeedLoader;
  readonly #admission = createGenerationAdmissionGate();
  #stopped = false;
  #working = false;
  get [generationAdmissionSource]() { return [this.#admission]; }

  constructor(state: PluginStateStore, outbound: OutboundHost, config: Readonly<RssConfig>, load: FeedLoader = fetchFeed) {
    if (!outbound.sendTarget) throw unavailable('管理员 RSS 需要支持精确目标的 Outbound Host');
    this.#state = state; this.#outbound = outbound; this.#config = config; this.#load = load;
  }
  stop(): void { this.#stopped = true; }

  async read(): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => this.#snapshot(readBook(await this.#state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY))));
  }
  async create(input: PluginTaskMutation & Readonly<{ target: DeliveryTarget; parameters: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => {
      assertMutation(input);
      let target: DeliveryTarget;
      try { target = createDeliveryTarget({ conversation: input.target }); } catch { throw invalid('请提供完整有效的目标账号、会话、父容器和线程'); }
      const url = parseParameters(input.parameters), fingerprint = digest({ operation: 'create', target, url });
      const task: Task = { id: input.requestId, creation: fingerprint, version: randomUUID(), url, target, createdAt: Date.now(), state: 'scheduled',
        seen: null, claimId: null, lastCheckAt: null, lastRunAt: null, detail: '等待首次抓取建立基线，不发送历史文章' };
      const revision = randomUUID();
      const book = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
        this.#assertLive(); const book = readBook(current);
        if (reconcile(book, input.requestId, fingerprint)) return book;
        assertRevision(book, input.expectedRevision);
        const existing = book.tasks.find(item => item.id === task.id);
        if (existing) { if (existing.creation !== fingerprint) throw conflict('同一请求 ID 已用于其他内容'); return book; }
        const active = book.tasks.filter(item => item.state !== 'cancelled' && item.state !== 'failed');
        if (active.length >= MAX_TASKS) throw invalid('管理员 RSS 订阅已达 8 条上限，请先取消任务');
        if (active.some(item => item.url === url && JSON.stringify(item.target) === JSON.stringify(target))) throw invalid('此完整目标已有该源的管理员订阅，请先核实原任务');
        const historyLimit = MAX_TASKS - active.length - 1;
        const history = historyLimit ? book.tasks.filter(item => item.state === 'cancelled' || item.state === 'failed').slice(-historyLimit) : [];
        return bounded({ version: 1, revision, tasks: [...active, ...history, task], receipts: receipt(book, input.requestId, fingerprint, task.id, 'create') });
      });
      return this.#snapshot(readBook(book));
    });
  }
  async change(input: PluginTaskMutation & Readonly<{ id: string; action: PluginTaskAction; parameters?: Readonly<Record<string, JsonValue>> }>): Promise<PluginTaskSnapshot> {
    return this.#admit(async () => {
      assertMutation(input);
      if (!isUuid(input.id) || !['pause', 'resume', 'cancel', 'update'].includes(input.action)) throw invalid('任务 ID 或操作无效');
      if (input.action !== 'update' && input.parameters !== undefined) throw invalid('仅编辑操作接受参数');
      const url = input.action === 'update' ? parseParameters(input.parameters) : undefined;
      const fingerprint = digest({ operation: input.action, id: input.id, url: url ?? null }), revision = randomUUID(), version = randomUUID();
      const result = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
        this.#assertLive(); const book = readBook(current);
        if (reconcile(book, input.requestId, fingerprint)) return book;
        assertRevision(book, input.expectedRevision);
        const task = book.tasks.find(item => item.id === input.id);
        if (!task) throw new PluginTaskError('not_found', '未找到当前实例的管理员 RSS 订阅；聊天订阅不在此入口管理');
        let changed: Task;
        switch (input.action) {
          case 'pause':
            if (task.state !== 'scheduled') throw invalid('仅待轮询订阅可以暂停');
            changed = { ...task, version, state: 'paused', detail: '管理员暂停；恢复时重新建立基线，不补发暂停期间文章' }; break;
          case 'resume':
            if (task.state !== 'paused') throw invalid('仅暂停订阅可以恢复；未确认投递不能恢复或重试');
            changed = { ...task, version, state: 'scheduled', seen: null, detail: '已恢复，等待重新建立基线，不补发历史文章' }; break;
          case 'update':
            if (task.state !== 'paused') throw invalid('编辑前请先暂停订阅；未确认投递不能编辑');
            if (book.tasks.some(item => item.id !== task.id && item.state !== 'cancelled' && item.state !== 'failed' && item.url === url
              && JSON.stringify(item.target) === JSON.stringify(task.target))) throw invalid('此完整目标已有该源的管理员订阅');
            changed = { ...task, version, url: url!, seen: null, detail: '已编辑并保持暂停，恢复后首次抓取只建立基线' }; break;
          case 'cancel':
            if (task.state === 'cancelled' || task.state === 'failed') throw invalid('任务已结束，不能再次取消');
            changed = { ...task, version, state: 'cancelled', detail: '管理员取消；已经开始的投递无法撤回' }; break;
        }
        return bounded({ ...book, revision, tasks: book.tasks.map(item => item.id === task.id ? changed : item), receipts: receipt(book, input.requestId, fingerprint, task.id, input.action) });
      });
      return this.#snapshot(readBook(result));
    });
  }

  /** Called by the plugin's one existing RSS poll registration, never by chat rss-check. */
  async tick(): Promise<void> {
    if (this.#stopped || this.#working) return;
    this.#working = true;
    try {
      await this.#admit(async () => {
        const tasks = readBook(await this.#state.get<AdministratorRssBook>(ADMIN_RSS_STATE_KEY)).tasks;
        for (const task of tasks) {
          if (this.#stopped) break;
          if (task.state !== 'scheduled') continue;
          let feed: Awaited<ReturnType<FeedLoader>>;
          try { feed = await this.#load(task.url, this.#config.timeout); }
          catch { await this.#recordCheck(task, '源站抓取失败；尚未尝试投递，下轮重查'); continue; }
          if (this.#stopped) break;
          // Keep only bounded identifiers, never arbitrary feed bodies, in durable state.
          const unique = new Map<string, FeedItem>();
          for (const item of feed.items.slice(0, 20)) if (item.guid) unique.set(digest(item.guid), item);
          const newItems = task.seen === null ? [] : [...unique].filter(([key]) => !task.seen!.includes(key)).map(([, item]) => item);
          const seen = [...new Set([...unique.keys(), ...(task.seen ?? [])])].slice(0, MAX_SEEN);
          const claimId = randomUUID(), version = randomUUID(), revision = randomUUID(), now = Date.now();
          const result = await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
            const book = readBook(current);
            const live = book.tasks.find(item => item.id === task.id);
            if (this.#stopped || live?.version !== task.version || live.state !== 'scheduled') return current;
            const changed: Task = { ...live, seen, version, lastCheckAt: now, ...(newItems.length
              ? { state: 'unknown', claimId, lastRunAt: now, detail: '投递中或未确认；不会自动重试' }
              : { detail: task.seen === null ? '已建立基线；从后续新文章开始推送' : '抓取完成，暂无新文章' }) };
            return bounded({ ...book, revision, tasks: book.tasks.map(item => item.id === task.id ? changed : item) });
          });
          const claimed = readBook(result).tasks.find(item => item.id === task.id && item.claimId === claimId && item.state === 'unknown');
          if (!claimed || this.#stopped) continue;
          let state: Task['state'] = 'unknown', detail = '平台未确认投递，请核实目标会话后取消并另建订阅；不会自动重试';
          try {
            const id = await this.#outbound.sendTarget!(claimed.target, formatNewItems(feed.title || claimed.url, newItems, this.#config.maxItems));
            if (id) { state = 'scheduled'; detail = '已确认投递；等待后续新文章'; }
          } catch (error) {
            if (error instanceof EndpointDeliveryError && error.disposition !== 'unknown') { state = 'failed'; detail = '平台明确未投递或拒绝；订阅已停止'; }
          }
          const settledRevision = randomUUID(), settledVersion = randomUUID();
          await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
            const book = readBook(current);
            const live = book.tasks.find(item => item.id === task.id);
            if (live?.claimId !== claimId || live.state !== 'unknown') return current;
            return bounded({ ...book, revision: settledRevision, tasks: book.tasks.map(item => item.id === task.id
              ? { ...item, state, detail, version: settledVersion } : item) });
          });
        }
      });
    } finally { this.#working = false; }
  }
  async #recordCheck(task: Task, detail: string): Promise<void> {
    if (this.#stopped) return;
    const revision = randomUUID(), version = randomUUID(), now = Date.now();
    await this.#state.update<AdministratorRssBook>(ADMIN_RSS_STATE_KEY, current => {
      const book = readBook(current);
      if (this.#stopped || !book.tasks.some(item => item.id === task.id && item.version === task.version && item.state === 'scheduled')) return current;
      return bounded({ ...book, revision, tasks: book.tasks.map(item => item.id === task.id ? { ...item, version, detail, lastCheckAt: now } : item) });
    });
  }
  #assertLive(): void { if (this.#stopped) throw unavailable('管理员 RSS 服务属于已停止的插件实例'); }
  async #admit<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertLive(); const release = this.#admission.acquire();
    if (!release) throw unavailable('管理员 RSS 服务属于未发布或已退役的 generation');
    try { return await operation(); } finally { release(); }
  }
  #snapshot(book: AdministratorRssBook): PluginTaskSnapshot {
    return { revision: book.revision, receipts: book.receipts.map(item => ({ requestId: item.id, taskId: item.taskId, operation: item.operation })),
      tasks: book.tasks.map(task => ({ id: task.id, ownership: 'administrator', title: `RSS · ${task.url}`.slice(0, 200), target: task.target,
        state: task.state, createdAt: task.createdAt, ...(task.lastRunAt === null ? {} : { lastRunAt: task.lastRunAt }), parameters: { url: task.url },
        detail: `${task.detail}；实例轮询 ${this.#config.pollCron}${task.lastCheckAt === null ? '' : `；最近抓取 ${new Date(task.lastCheckAt).toISOString()}`}；状态不代表平台连接健康`,
        actions: task.state === 'scheduled' ? ['pause', 'cancel'] : task.state === 'paused' ? ['update', 'resume', 'cancel'] : task.state === 'unknown' ? ['cancel'] : [],
      })) };
  }
}

function parseParameters(value: Readonly<Record<string, JsonValue>> | undefined): string {
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.url !== 'string' || value.url.length > 2048) throw invalid('参数须包含有效 HTTP(S) RSS 地址');
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/u.test(value.url)) throw new Error('url');
    url.hash = '';
    if (url.href.length > 2048) throw new Error('url length');
    return url.href;
  } catch { throw invalid('请提供有效 HTTP(S) RSS 地址，不接受 URL 用户名或密码'); }
}
function assertMutation(input: PluginTaskMutation): void {
  if (!isUuid(input.requestId) || typeof input.expectedRevision !== 'string'
    || !input.expectedRevision || input.expectedRevision.length > 128) throw invalid('操作须包含 UUID requestId 和读取到的 expectedRevision');
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function isDigest(value: unknown): value is string { return typeof value === 'string' && DIGEST.test(value); }
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}
function invalid(message: string): PluginTaskError { return new PluginTaskError('invalid_input', message); }
function conflict(message: string): PluginTaskError { return new PluginTaskError('conflict', message); }
function unavailable(message: string): PluginTaskError { return new PluginTaskError('unavailable', message); }
function assertRevision(book: AdministratorRssBook, revision: string): void { if (book.revision !== revision) throw conflict('订阅状态已变化，请刷新后重新确认'); }
function reconcile(book: AdministratorRssBook, id: string, fingerprint: string): boolean {
  const previous = book.receipts.find(item => item.id === id);
  if (!previous) return false;
  if (previous.fingerprint !== fingerprint) throw conflict('同一操作请求 ID 已用于其他内容，禁止重放');
  return true;
}
function receipt(book: AdministratorRssBook, id: string, fingerprint: string, taskId: string, operation: Receipt['operation']): readonly Receipt[] {
  return [...book.receipts, { id, fingerprint, taskId, operation }].slice(-MAX_RECEIPTS);
}
function bounded(book: AdministratorRssBook): AdministratorRssBook {
  if (book.tasks.length > MAX_TASKS || new TextEncoder().encode(JSON.stringify(book)).byteLength > 60 * 1024) throw invalid('管理员 RSS 状态达到 8 条或 60 KiB 上限，请先取消并整理订阅');
  return book;
}
function readBook(value: AdministratorRssBook | undefined): AdministratorRssBook {
  if (value === undefined) return { version: 1, revision: '0', tasks: [], receipts: [] };
  try {
    if (!value || value.version !== 1 || (value.revision !== '0' && !isUuid(value.revision))
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
        || typeof task.detail !== 'string' || task.detail.length > 1000 || parseParameters({ url: task.url }) !== task.url) throw new Error('task');
      const target = createDeliveryTarget({ conversation: task.target });
      if (JSON.stringify(target) !== JSON.stringify(task.target)) throw new Error('target');
      ids.add(task.id);
    }
    return bounded(value);
  } catch { throw unavailable('管理员 RSS 持久状态格式无效，已停止管理员轮询与投递；请保留原数据核查'); }
}
