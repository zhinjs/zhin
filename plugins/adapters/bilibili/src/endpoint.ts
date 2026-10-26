/**
 * BilibiliEndpoint — 白名单视频评论轮询 + 先审再发（Experimental）。
 *
 * - 入站：轮询 `x/v2/reply`，首轮只建基线；新评论按「评论楼」归 conversation 后 emit `message.receive`。
 *   可选再轮询「回复我的 / @我的」通知（`x/msgfeed/reply|at`），以 `mentioned: true` 入站。
 * - 出站：`send()` 永远只把回复放进草稿队列（review），不会调用平台写接口。
 * - 审批：`approveDraft()` 由人触发（`bili-draft send <id>` 命令），才会调用 `x/v2/reply/add` 真正发出。
 * - 风控错误码立即熔断，停止轮询与发送，不自动重试。
 */
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { Endpoint, type EndpointSendRequest, type EndpointTransportState } from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { BilibiliApiError, BilibiliClient, type BilibiliFetch } from './client.js';
import { BilibiliDraftQueue, type BilibiliReplyDraft } from './drafts.js';
import {
  BILIBILI_COMMENT_MAX_LENGTH,
  bilibiliThreadConversation,
  flattenReplies,
  formatOutboundText,
  notificationToReply,
  outboundReplyTarget,
  parseThreadConversationId,
  threadRootOf,
  type BilibiliNotificationKind,
  type BilibiliReply,
  type ResolvedBilibiliConfig,
} from './protocol.js';

const SEEN_CAPACITY = 5_000;
const CONTEXT_CAPACITY = 500;
const CONTEXT_EXCERPT = 120;

export type BilibiliReviewErrorCode =
  | 'not_found'
  | 'busy'
  | 'send_disabled'
  | 'circuit_open'
  | 'no_cookie'
  | 'rate_limited'
  | 'invalid_message'
  | 'platform_error';

/** 审批 / 发送草稿失败。草稿除 `not_found` 外都会保留在队列里。 */
export class BilibiliReviewError extends Error {
  constructor(readonly code: BilibiliReviewErrorCode, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'BilibiliReviewError';
  }
}

export interface BilibiliSentReply {
  readonly draft: BilibiliReplyDraft;
  /** 平台返回的新评论 rpid。 */
  readonly rpid: string;
}

type InboundVia = 'video' | BilibiliNotificationKind;

export interface BilibiliEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedBilibiliConfig;
  readonly fetch?: BilibiliFetch;
  /** 轮询抖动随机源（测试注入）。 */
  readonly random?: () => number;
  /** 关闭自动定时轮询（测试中手动调用 pollOnce）。 */
  readonly autoPoll?: boolean;
  /** 时钟（测试注入）。 */
  readonly now?: () => number;
  /** stop() 时从插件实例的审批注册表里移除自己。 */
  readonly registry?: Map<string, BilibiliEndpoint>;
}

export class BilibiliEndpoint extends Endpoint<BilibiliClient> {
  readonly client: BilibiliClient;
  readonly drafts = new BilibiliDraftQueue();
  readonly #options: BilibiliEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #aids: string[] = [];
  readonly #baselined = new Set<string>();
  readonly #seen = new Set<string>();
  /** rpid → 评论摘要，用于草稿审批时展示被回复的原文。 */
  readonly #context = new Map<string, { readonly author: string; readonly text: string }>();
  /** 通知源基线：已处理的最大通知 id。undefined = 尚未建基线。 */
  readonly #notificationCursor = new Map<BilibiliNotificationKind, number>();
  #lastSentAt = 0;
  #selfMid?: string;
  #timer?: ReturnType<typeof setTimeout>;
  #state: EndpointTransportState = 'idle';
  #open = false;
  #started = false;
  #tripped?: { readonly code: number; readonly message: string };

  constructor(options: BilibiliEndpointOptions) {
    super();
    this.#options = options;
    this.#logger = getAdapterLogger('bilibili', options.config.id);
    this.client = new BilibiliClient(options.config, options.fetch ?? (globalThis.fetch as unknown as BilibiliFetch));
  }

  override get transportState(): EndpointTransportState {
    return this.#state;
  }

  /** 熔断原因；非空时轮询已停止，需要人工处理后重启。 */
  get circuitBreaker(): Readonly<{ code: number; message: string }> | undefined {
    return this.#tripped;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#state = 'connecting';
    try {
      this.#selfMid = await this.client.getSelfMid();
      if (this.client.hasCookie && !this.#selfMid) {
        this.#logger.warn(formatCompact({ op: 'bilibili_login_invalid', hint: 'SESSDATA 失效，请重新获取 Cookie' }));
      }
      this.reportSelfUserId(this.#selfMid);
      for (const video of this.#options.config.videos) {
        this.#aids.push(video.kind === 'aid' ? video.aid : await this.client.resolveAid(video.bvid));
      }
    } catch (error) {
      this.#handleError('start', error);
      if (this.#tripped) return;
      throw error;
    }
    if (this.#options.config.notifications.length > 0 && !this.#selfMid) {
      this.#logger.warn(formatCompact({ op: 'bilibili_notifications_disabled', hint: '「回复我的 / @我的」需要有效 Cookie' }));
    }
    if (this.#aids.length === 0) {
      this.#logger.warn(formatCompact({ op: 'bilibili_no_videos', hint: '未配置 videos 白名单，不会轮询' }));
    }
    this.#state = 'open';
    if (this.#options.autoPoll !== false && this.#aids.length > 0) this.#schedule(0);
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  stop(): void {
    this.#open = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#started = false;
    this.#state = 'stopped';
    const registry = this.#options.registry;
    if (registry?.get(this.#options.config.id) === this) registry.delete(this.#options.config.id);
  }

  get #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  /** 已解析的白名单视频 aid。 */
  get videoAids(): readonly string[] {
    return Object.freeze([...this.#aids]);
  }

  #schedule(delayMs: number): void {
    if (this.#tripped || !this.#started) return;
    this.#timer = setTimeout(() => {
      void this.pollOnce().finally(() => {
        const base = this.#options.config.pollIntervalMs;
        const jitter = Math.floor(base * 0.2 * (this.#options.random ?? Math.random)());
        this.#schedule(base + jitter);
      });
    }, delayMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  /** 轮询一次全部白名单视频。首轮只记录基线，不入站。 */
  async pollOnce(): Promise<void> {
    for (const aid of this.#aids) {
      if (this.#tripped) return;
      try {
        const page = await this.client.listLatestVideoReplies(aid);
        const replies = flattenReplies(page.replies).sort((a, b) => a.ctime - b.ctime);
        if (!this.#baselined.has(aid)) {
          for (const reply of replies) this.#markSeen(String(reply.rpid));
          this.#baselined.add(aid);
          continue;
        }
        for (const reply of replies) {
          const rpid = String(reply.rpid);
          if (this.#seen.has(rpid)) continue;
          this.#markSeen(rpid);
          await this.#admit(aid, reply, { via: 'video', upperMid: page.upper?.mid });
        }
      } catch (error) {
        this.#handleError('poll', error, aid);
      }
    }
    await this.pollNotificationsOnce();
  }

  /**
   * 轮询「回复我的 / @我的」通知（配置 `notifications` 开启时）。首轮只记录基线。
   * 只收视频评论通知；`notificationScope: whitelist`（默认）时只收白名单视频下的。
   */
  async pollNotificationsOnce(): Promise<void> {
    const { notifications, notificationScope } = this.#options.config;
    if (notifications.length === 0 || !this.client.hasCookie || !this.#selfMid) return;
    for (const kind of notifications) {
      if (this.#tripped) return;
      try {
        const page = await this.client.listNotifications(kind);
        const items = [...(page.items ?? [])].filter((entry) => Number.isFinite(entry?.id)).sort((a, b) => a.id - b.id);
        const cursor = this.#notificationCursor.get(kind);
        const newest = items.reduce((max, entry) => Math.max(max, entry.id), cursor ?? 0);
        this.#notificationCursor.set(kind, newest);
        if (cursor === undefined) continue; // 首轮基线
        for (const entry of items) {
          if (entry.id <= cursor) continue;
          const reply = notificationToReply(entry);
          if (!reply) continue;
          const aid = String(reply.oid);
          if (notificationScope === 'whitelist' && !this.#aids.includes(aid)) continue;
          const rpid = String(reply.rpid);
          if (this.#seen.has(rpid)) continue;
          this.#markSeen(rpid);
          await this.#admit(aid, reply, { via: kind });
        }
      } catch (error) {
        this.#handleError(`notify_${kind}`, error);
      }
    }
  }

  #markSeen(rpid: string): void {
    this.#seen.add(rpid);
    if (this.#seen.size > SEEN_CAPACITY) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
  }

  #remember(reply: BilibiliReply): void {
    const text = (reply.content?.message ?? '').replace(/\s+/g, ' ').trim();
    const excerpt = [...text].length > CONTEXT_EXCERPT ? `${[...text].slice(0, CONTEXT_EXCERPT).join('')}…` : text;
    this.#context.set(String(reply.rpid), Object.freeze({ author: reply.member?.uname ?? String(reply.mid), text: excerpt }));
    if (this.#context.size > CONTEXT_CAPACITY) {
      const oldest = this.#context.keys().next().value;
      if (oldest !== undefined) this.#context.delete(oldest);
    }
  }

  async #admit(
    aid: string,
    reply: BilibiliReply,
    options: { readonly via: InboundVia; readonly upperMid?: number },
  ): Promise<void> {
    if (!this.#open) return;
    const mid = String(reply.mid);
    if (this.#selfMid && mid === this.#selfMid) return; // 防自回环
    this.#remember(reply);
    const rootId = threadRootOf(reply);
    const parentId = String(reply.parent || reply.rpid);
    const conversation = bilibiliThreadConversation(String(this.#options.id), aid, rootId);
    const addressedToMe = options.via !== 'video';
    void this.emitPlatform('reply', reply).catch(() => undefined);
    await this.emit('message.receive', {
      conversation,
      message: { conversation, id: String(reply.rpid) },
      content: reply.content?.message ?? '',
      sender: { id: mid, name: reply.member?.uname ?? mid },
      endpointId: this.#options.config.id,
      ...(addressedToMe ? { mentioned: true } : {}),
      ...(reply.parent && String(reply.parent) !== String(reply.rpid) ? { replyTo: { id: String(reply.parent) } } : {}),
      metadata: Object.freeze({
        resource: Object.freeze({ type: 'video', oid: aid }),
        rootId,
        parentId,
        via: options.via,
        createdAt: reply.ctime * 1000,
        likeCount: reply.like ?? 0,
        isUploader: options.upperMid !== undefined && Number(reply.mid) === Number(options.upperMid),
      }),
    }).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'bilibili_gateway_receive_failed',
        target: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #handleError(op: string, error: unknown, aid?: string): void {
    if (error instanceof BilibiliApiError && error.code === -101 && op.startsWith('notify_')) {
      this.#logger.warn(formatCompact({ op: 'bilibili_login_invalid', stage: op, hint: 'SESSDATA 失效，请重新获取 Cookie' }));
      return;
    }
    if (error instanceof BilibiliApiError && error.risk) {
      this.#tripped = { code: error.code, message: error.message };
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#state = 'closed';
      this.#logger.error(formatCompact({
        op: 'bilibili_circuit_open', stage: op, aid, code: error.code,
        hint: '触发平台风控，已停止轮询；请人工确认账号状态后重启',
      }));
      return;
    }
    this.#logger.warn(formatCompact({
      op: `bilibili_${op}_failed`, aid,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  /**
   * 出站 = 回复评论楼。**永远**只进草稿队列，返回 not_sent（approval_pending），不调用平台写接口；
   * 真正发出必须由人调用 {@link approveDraft}（`bili-draft send <id>`）。
   */
  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const thread = parseThreadConversationId(conversation.id);
    if (!thread) {
      throw new EndpointDeliveryError('invalid_recipient',
        `Bilibili conversation must be video:<aid>:<rootRpid>, got "${conversation.id}"`, 'not_sent');
    }
    const message = formatOutboundText(payload);
    const invalid = validateReplyText(message);
    if (invalid) throw new EndpointDeliveryError('invalid_payload', invalid, 'not_sent');
    if (this.#options.config.sendMode === 'off') {
      throw new EndpointDeliveryError('send_disabled', 'Bilibili sendMode is off', 'not_sent');
    }
    const parent = outboundReplyTarget(payload) ?? thread.root;
    const context = this.#context.get(parent) ?? this.#context.get(thread.root);
    const draft: BilibiliReplyDraft = this.drafts.add({
      endpointId: this.#options.config.id,
      target: conversation.id,
      oid: thread.oid,
      root: thread.root,
      parent,
      message,
      ...(context ? { context } : {}),
    }, this.#now);
    this.#logger.info(formatCompact({ op: 'bilibili_draft_queued', draft: draft.id, target: conversation.id }));
    throw new EndpointDeliveryError('approval_pending',
      `Reply queued as draft ${draft.id}; master approval is required before posting`, 'not_sent');
  }

  /** 审批前修改草稿正文。 */
  editDraft(id: string, message: string): BilibiliReplyDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new BilibiliReviewError('not_found', `Draft ${id} not found`);
    if (draft.status === 'sending') throw new BilibiliReviewError('busy', `Draft ${id} is being sent`);
    const text = message.trim();
    const invalid = validateReplyText(text);
    if (invalid) throw new BilibiliReviewError('invalid_message', invalid);
    return this.drafts.update(id, { message: text }, this.#now)!;
  }

  /** 丢弃草稿（不发送）。 */
  discardDraft(id: string): boolean {
    const draft = this.drafts.get(id);
    if (draft?.status === 'sending') throw new BilibiliReviewError('busy', `Draft ${id} is being sent`);
    const removed = this.drafts.discard(id);
    if (removed) this.#logger.info(formatCompact({ op: 'bilibili_draft_discarded', draft: id }));
    return removed;
  }

  /**
   * 人工审批后真正发出草稿（`POST x/v2/reply/add`）。成功后草稿出队。
   *
   * 保护：sendMode=off / 已熔断 / 无 Cookie / 发送中 / 距上次发送不足 `minSendIntervalSec` 都直接拒绝，
   * 不排队、不自动重试。平台风控错误码会熔断整个 endpoint（同时停止轮询）。
   */
  async approveDraft(id: string): Promise<BilibiliSentReply> {
    const draft = this.drafts.get(id);
    if (!draft) throw new BilibiliReviewError('not_found', `Draft ${id} not found`);
    if (draft.status === 'sending') throw new BilibiliReviewError('busy', `Draft ${id} is already being sent`);
    if (this.#options.config.sendMode === 'off') {
      throw new BilibiliReviewError('send_disabled', 'Bilibili sendMode is off');
    }
    if (this.#tripped) {
      throw new BilibiliReviewError('circuit_open',
        `Circuit breaker open (${this.#tripped.code}); check the account on bilibili.com and restart`);
    }
    if (!this.client.config.sessdata || !this.client.config.biliJct) {
      throw new BilibiliReviewError('no_cookie', 'SESSDATA and bili_jct are required to post replies');
    }
    const invalid = validateReplyText(draft.message);
    if (invalid) throw new BilibiliReviewError('invalid_message', invalid);
    const wait = this.#lastSentAt + this.#options.config.minSendIntervalMs - this.#now;
    if (this.#lastSentAt > 0 && wait > 0) {
      throw new BilibiliReviewError('rate_limited', `Wait ${Math.ceil(wait / 1000)}s before sending another reply`, wait);
    }
    this.drafts.update(id, { status: 'sending' }, this.#now);
    this.#lastSentAt = this.#now;
    try {
      const rpid = await this.client.addReply({
        oid: draft.oid,
        root: draft.root,
        parent: draft.parent,
        message: draft.message,
      });
      this.#markSeen(rpid);
      this.drafts.discard(id);
      this.#logger.info(formatCompact({ op: 'bilibili_draft_sent', draft: id, target: draft.target, rpid }));
      return Object.freeze({ draft, rpid });
    } catch (error) {
      this.drafts.update(id, { status: 'pending' }, this.#now);
      this.#handleError('send', error);
      if (error instanceof BilibiliApiError && error.risk) {
        throw new BilibiliReviewError('circuit_open',
          `Bilibili risk control (${error.code}); endpoint stopped, draft kept`);
      }
      throw new BilibiliReviewError('platform_error', error instanceof Error ? error.message : String(error));
    }
  }
}

function validateReplyText(message: string): string | undefined {
  if (!message) return 'Empty Bilibili reply';
  if ([...message].length > BILIBILI_COMMENT_MAX_LENGTH) {
    return `Bilibili reply exceeds ${BILIBILI_COMMENT_MAX_LENGTH} characters`;
  }
  return undefined;
}
