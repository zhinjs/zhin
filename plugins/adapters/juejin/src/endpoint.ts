/**
 * JuejinEndpoint — 白名单文章评论轮询 + 先审再发（Experimental）。
 *
 * - 入站：轮询 `comment/list`（最新一页），首轮只建基线；新评论按「评论楼」归 conversation 后 emit `message.receive`。
 *   同一评论 / 回复 id 只入站一次；自己（登录账号 uid 或平台标记的文章作者）发的不入站，防自回环。
 * - 出站：`send()` 永远只把回复放进草稿队列（review），不会调用平台写接口。
 * - 审批：`approveDraft()` 由人触发（Console「掘金评论审批」页或 `juejin-draft send <id>`），才会调用 `reply/publish` 真正发出。
 * - 风控（HTTP 403/429、非 JSON、`err_msg` 含频繁 / 验证码等）立即熔断，停止轮询与发送，不自动重试。
 */
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification, type EndpointSendRequest, type EndpointTransportState } from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { JuejinApiError, JuejinClient, type JuejinFetch } from './client.js';
import { createJuejinSelfProfile } from './self-profile.js';
import { JuejinDraftQueue, type JuejinReplyDraft } from './drafts.js';
import { JuejinStateFiles } from './storage.js';
import {
  articleUrl,
  flattenComments,
  formatOutboundText,
  juejinThreadConversation,
  outboundReplyTarget,
  parseThreadConversationId,
  validateReplyText,
  type JuejinComment,
  type ResolvedJuejinConfig,
} from './protocol.js';

const SEEN_CAPACITY = 5_000;
const CONTEXT_CAPACITY = 500;
const CONTEXT_EXCERPT = 120;

export type JuejinReviewErrorCode =
  | 'not_found'
  | 'busy'
  | 'send_disabled'
  | 'circuit_open'
  | 'no_cookie'
  | 'rate_limited'
  | 'invalid_message'
  | 'unknown_outcome'
  | 'platform_error';

/** 审批 / 发送草稿失败。草稿除 `not_found` 外都会保留在队列里。 */
export class JuejinReviewError extends Error {
  constructor(readonly code: JuejinReviewErrorCode, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'JuejinReviewError';
  }
}

export interface JuejinSentReply {
  readonly draft: JuejinReplyDraft;
  /** 平台返回的新回复 id；平台没给时省略。 */
  readonly replyId?: string;
}

/** 登录态：none=没有 Cookie；ok=Cookie 有效；expired=Cookie 失效需要更新。 */
export type JuejinLoginState = 'none' | 'ok' | 'expired';

export interface JuejinLoginStatus {
  readonly state: JuejinLoginState;
  readonly userId?: string;
  readonly userName?: string;
}

/** Console / 状态用的白名单文章视图（不含 Cookie）。 */
export interface JuejinArticleView {
  readonly id: string;
  readonly url: string;
}

/** 主动提醒的事件；文案由插件层按语言渲染。 */
export type JuejinNotice =
  | { readonly kind: 'draft'; readonly draft: JuejinReplyDraft }
  | { readonly kind: 'login_expired' };

export interface JuejinEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly config: ResolvedJuejinConfig;
  readonly fetch?: JuejinFetch;
  /** 轮询抖动随机源（测试注入）。 */
  readonly random?: () => number;
  /** 关闭自动定时轮询（测试中手动调用 pollOnce）。 */
  readonly autoPoll?: boolean;
  /** 时钟（测试注入）。 */
  readonly now?: () => number;
  /** 本地状态目录（草稿）。省略 = 只存内存（测试用）；adapter 默认传 `config.dataDir`。 */
  readonly stateDir?: string;
  /** 新草稿 / 登录失效时的主动提醒（失败只记日志，不影响草稿）。 */
  readonly notify?: (notice: JuejinNotice) => void | Promise<void>;
}

export class JuejinEndpoint extends JuejinClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly drafts: JuejinDraftQueue;
  readonly #files?: JuejinStateFiles;
  readonly #options: JuejinEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #baselined = new Set<string>();
  readonly #seen = new Set<string>();
  /** 评论 / 回复 id → 摘要（作者 + 原文 + 作者 uid），用于草稿审批时展示被回复的原文。 */
  readonly #context = new Map<string, { readonly author: string; readonly text: string; readonly rootId: string }>();
  #lastSentAt = 0;
  #selfUid?: string;
  #timer?: ReturnType<typeof setTimeout>;
  #state: EndpointTransportState = 'idle';
  #open = false;
  #started = false;
  #tripped?: { readonly code: number; readonly message: string };
  #login: JuejinLoginStatus = Object.freeze({ state: 'none' });

  constructor(options: JuejinEndpointOptions) {
    super(options.config, options.fetch ?? (globalThis.fetch as unknown as JuejinFetch), options.signal);
    this.#options = options;
    const readTransportState = () => this.#transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => this.#openEndpoint(),
      close: () => this.#close(), stop: () => this.#stop(),
      send: request => this.#send(request),
      profile: createJuejinSelfProfile({ client: this, reportAccount: id => this[endpointSpec].reportSelfUserId(id) }),
      get transportState() { return readTransportState(); },
    });
    this.#logger = getAdapterLogger('juejin', options.config.id);
    this.#files = options.stateDir ? new JuejinStateFiles(options.stateDir, options.config.stateDirectoryId ?? options.config.id) : undefined;
    this.drafts = new JuejinDraftQueue({
      ...(this.#files ? { file: this.#files.draftsFile } : {}),
      onPersistError: (error) => this.#logger.warn(formatCompact({
        op: 'juejin_draft_persist_failed', error: error instanceof Error ? error.message : String(error),
      })),
    });
    if (this.drafts.size > 0) {
      this.#logger.info(formatCompact({ op: 'juejin_drafts_restored', count: this.drafts.size }));
    }
  }

  /** 当前登录态（不含 Cookie 本身）。 */
  get login(): JuejinLoginStatus {
    return this.#login;
  }

  /** 草稿是否落盘（配置了数据目录）。 */
  get persistent(): boolean {
    return this.#files !== undefined;
  }

  /** 配置里的白名单文章。 */
  get articles(): readonly JuejinArticleView[] {
    return Object.freeze(this.#options.config.articles.map(id => Object.freeze({ id, url: articleUrl(id) })));
  }

  get sendMode(): ResolvedJuejinConfig['sendMode'] {
    return this.#options.config.sendMode;
  }

  get localId(): string {
    return this.#options.config.id;
  }

  get #transportState(): EndpointTransportState {
    return this.#state;
  }

  /** 熔断原因；非空时轮询已停止，需要人工处理后重启。 */
  get circuitBreaker(): Readonly<{ code: number; message: string }> | undefined {
    return this.#tripped;
  }

  get #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#state = 'connecting';
    try {
      await this.#resolveLogin();
    } catch (error) {
      this.#handleError('start', error);
      if (this.#tripped) return;
      throw error;
    }
    this[endpointSpec].reportSelfUserId(this.#selfUid);
    if (this.#options.config.articles.length === 0) {
      this.#logger.warn(formatCompact({ op: 'juejin_no_articles', hint: '未配置 articles 白名单，不会轮询' }));
    }
    this.#state = 'open';
    if (this.#options.autoPoll !== false && this.#options.config.articles.length > 0) this.#schedule(0);
  }

  #openEndpoint(): void {
    this.#open = true;
  }

  #close(): void {
    this.#open = false;
  }

  #stop(): void {
    this.#open = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#started = false;
    this.#state = 'stopped';
  }

  /** 用配置 / 环境变量里的 Cookie 识别账号；失效时登录态为 expired，只读轮询照常。 */
  async #resolveLogin(): Promise<void> {
    const cookie = this.#options.config.cookie;
    this.setCookie(cookie);
    if (!cookie) {
      this.#selfUid = undefined;
      this.#login = Object.freeze({ state: 'none' as const });
      return;
    }
    const self = await this.getSelf();
    if (self) {
      this.#selfUid = self.userId;
      this.#login = Object.freeze({ state: 'ok' as const, userId: self.userId, ...(self.userName ? { userName: self.userName } : {}) });
      return;
    }
    this.#selfUid = undefined;
    this.#login = Object.freeze({ state: 'expired' as const });
    this.#logger.warn(formatCompact({ op: 'juejin_login_invalid', hint: '配置里的掘金 Cookie 已失效，请更新环境变量后重启' }));
  }

  /** 重新检查 Cookie（Console「重新检查登录」）。不会切换账号：新 uid 与已识别的不一致时拒绝。 */
  async recheckLogin(): Promise<JuejinLoginStatus> {
    const previous = this.#selfUid;
    const before = this.#login.state;
    try {
      await this.#resolveLogin();
    } catch (error) {
      this.#handleError('login_check', error);
      throw error;
    }
    if (previous && this.#selfUid && previous !== this.#selfUid) {
      this.#tripped = { code: -3, message: 'Juejin account changed; restart the endpoint after updating the config' };
      this.#halt('login_check');
    }
    if (this.#login.state === 'expired' && before !== 'expired') this.#emitNotice({ kind: 'login_expired' });
    return this.#login;
  }

  /** Cookie 被平台判定失效（err_no 403）：登录态置为 expired，并提醒一次。 */
  #markLoginExpired(stage: string): void {
    if (this.#login.state === 'expired') return;
    this.#login = Object.freeze({ state: 'expired' as const });
    this.#logger.warn(formatCompact({ op: 'juejin_login_invalid', stage, hint: 'Cookie 已失效，请更新 JUEJIN_COOKIE 后重启' }));
    this.#emitNotice({ kind: 'login_expired' });
  }

  #emitNotice(notice: JuejinNotice): void {
    const notify = this.#options.notify;
    if (!notify) return;
    void Promise.resolve().then(() => notify(notice)).catch((error: unknown) => {
      this.#logger.warn(formatCompact({
        op: 'juejin_notify_failed', kind: notice.kind,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
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

  /** 轮询一次全部白名单文章。每篇首轮只记录基线，不入站。 */
  async pollOnce(): Promise<void> {
    for (const articleId of this.#options.config.articles) {
      if (this.#tripped) return;
      try {
        const page = await this.listLatestComments(articleId);
        await this[endpointSpec].events.run(async () => {
          const comments = flattenComments(articleId, page.comments).sort((a, b) => a.ctime - b.ctime);
          if (!this.#baselined.has(articleId)) {
            for (const comment of comments) { this.#markSeen(comment.id); this.#remember(comment); }
            this.#baselined.add(articleId);
            return;
          }
          for (const comment of comments) {
            if (this.#seen.has(comment.id)) continue;
            this.#markSeen(comment.id);
            await this.#admit(comment);
          }
        });
      } catch (error) {
        this.#handleError('poll', error, `article:${articleId}`);
      }
    }
  }

  #markSeen(id: string): void {
    this.#seen.add(id);
    if (this.#seen.size > SEEN_CAPACITY) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
  }

  #remember(comment: JuejinComment): void {
    const text = comment.text.replace(/\s+/g, ' ').trim();
    const excerpt = [...text].length > CONTEXT_EXCERPT ? `${[...text].slice(0, CONTEXT_EXCERPT).join('')}…` : text;
    this.#context.set(comment.id, Object.freeze({ author: comment.userName ?? comment.userId, text: excerpt, rootId: comment.rootId }));
    if (this.#context.size > CONTEXT_CAPACITY) {
      const oldest = this.#context.keys().next().value;
      if (oldest !== undefined) this.#context.delete(oldest);
    }
  }

  /** 自己发的：登录账号 uid，或平台标记的文章作者（白名单只放自己的文章）。 */
  #isSelf(comment: JuejinComment): boolean {
    return comment.isAuthor || (this.#selfUid !== undefined && comment.userId === this.#selfUid);
  }

  async #admit(comment: JuejinComment): Promise<void> {
    if (!this.#open && !this.#started) return;
    this.#remember(comment);
    if (this.#isSelf(comment)) return; // 防自回环
    const conversation = { ...juejinThreadConversation(String(this.#options.id), comment.articleId, comment.rootId), endpoint: this[endpointSpec].identity };
    void this[endpointSpec].events.platform(comment.kind, comment).catch(() => undefined);
    await this[endpointSpec].events.message({
      event: comment,
      platformSentAt: comment.ctime * 1000,
      conversation,
      message: { conversation, id: comment.id },
      content: comment.text,
      sender: { id: comment.userId, name: comment.userName ?? comment.userId },
      endpointId: this.#options.config.id,
      ...(comment.parentId !== comment.id ? { replyTo: { id: comment.parentId } } : {}),
      metadata: Object.freeze({
        resource: Object.freeze({ type: 'article', articleId: comment.articleId, url: articleUrl(comment.articleId) }),
        rootId: comment.rootId,
        parentId: comment.parentId,
        kind: comment.kind,
        createdAt: comment.ctime * 1000,
        likeCount: comment.diggCount,
        isAuthor: comment.isAuthor,
      }),
    }).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'juejin_gateway_receive_failed',
        target: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #halt(stage: string, target?: string): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#state = 'closed';
    this.#logger.error(formatCompact({
      op: 'juejin_circuit_open', stage, target, code: this.#tripped?.code,
      hint: '触发掘金风控或账号异常，已停止轮询与发送；请人工确认账号状态后重启',
    }));
  }

  #handleError(op: string, error: unknown, target?: string): void {
    if (error instanceof JuejinApiError && error.loginRequired && op === 'send') {
      this.#markLoginExpired(op);
      return;
    }
    if (error instanceof JuejinApiError && error.risk) {
      this.#tripped = { code: error.code, message: error.message };
      this.#halt(op, target);
      return;
    }
    this.#logger.warn(formatCompact({
      op: `juejin_${op}_failed`, target,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  /**
   * 出站 = 回复评论楼。**永远**只进草稿队列，返回 not_sent（approval_pending），不调用平台写接口；
   * 真正发出必须由人调用 {@link approveDraft}。
   */
  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const thread = parseThreadConversationId(conversation.id);
    if (!thread) {
      throw new EndpointDeliveryError('invalid_recipient',
        `Juejin conversation must be article:<articleId>:<rootCommentId>, got "${conversation.id}"`, 'not_sent');
    }
    if (!this.#options.config.articles.includes(thread.articleId)) {
      throw new EndpointDeliveryError('invalid_recipient', `Juejin article ${thread.articleId} is not in the articles whitelist`, 'not_sent');
    }
    const message = formatOutboundText(payload);
    const invalid = validateReplyText(message);
    if (invalid) throw new EndpointDeliveryError('invalid_payload', invalid, 'not_sent');
    if (this.#options.config.sendMode === 'off') {
      throw new EndpointDeliveryError('send_disabled', 'Juejin sendMode is off', 'not_sent');
    }
    // 只接受同一评论楼里已知的回复目标；未知 / 跨楼的 reply 段退回到楼根，绝不回到别的楼。
    const requested = outboundReplyTarget(payload);
    const known = requested ? this.#context.get(requested) : undefined;
    const parent = requested && (requested === thread.root || known?.rootId === thread.root) ? requested : thread.root;
    const context = this.#context.get(parent) ?? this.#context.get(thread.root);
    const draft: JuejinReplyDraft = this.drafts.add({
      endpointId: this.#options.config.id,
      target: conversation.id,
      articleId: thread.articleId,
      root: thread.root,
      parent,
      message,
      ...(context ? { context: { author: context.author, text: context.text } } : {}),
    }, this.#now);
    this.#logger.info(formatCompact({ op: 'juejin_draft_queued', draft: draft.id, target: conversation.id }));
    this.#emitNotice({ kind: 'draft', draft });
    throw new EndpointDeliveryError('approval_pending',
      `Reply queued as draft ${draft.id}; master approval is required before posting`, 'not_sent');
  }

  /** 审批前修改草稿正文。 */
  editDraft(id: string, message: string): JuejinReplyDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new JuejinReviewError('not_found', `Draft ${id} not found`);
    if (draft.status === 'sending') throw new JuejinReviewError('busy', `Draft ${id} is being sent`);
    const text = message.trim();
    const invalid = validateReplyText(text);
    if (invalid) throw new JuejinReviewError('invalid_message', invalid);
    return this.drafts.update(id, { message: text }, this.#now)!;
  }

  /** 丢弃草稿（不发送）。 */
  discardDraft(id: string): boolean {
    const draft = this.drafts.get(id);
    if (draft?.status === 'sending') throw new JuejinReviewError('busy', `Draft ${id} is being sent`);
    const removed = this.drafts.discard(id);
    if (removed) this.#logger.info(formatCompact({ op: 'juejin_draft_discarded', draft: id }));
    return removed;
  }

  /**
   * 人工审批后真正发出草稿（`POST interact_api/v1/reply/publish`）。成功后草稿出队。
   *
   * 保护：sendMode=off / 已熔断 / 无有效 Cookie / 发送中 / 距上次发送不足 `minSendIntervalSec` 都直接拒绝，
   * 不排队、不自动重试。风控会熔断整个 endpoint（同时停止轮询）；结果未知时草稿保留并标记「可能已发出」。
   */
  async approveDraft(id: string): Promise<JuejinSentReply> {
    const draft = this.drafts.get(id);
    if (!draft) throw new JuejinReviewError('not_found', `Draft ${id} not found`);
    if (draft.status === 'sending') throw new JuejinReviewError('busy', `Draft ${id} is already being sent`);
    if (this.#options.config.sendMode === 'off') {
      throw new JuejinReviewError('send_disabled', 'Juejin sendMode is off');
    }
    if (this.#tripped) {
      throw new JuejinReviewError('circuit_open',
        `Circuit breaker open (${this.#tripped.code}); check the account on juejin.cn and restart`);
    }
    if (!this.hasCookie || this.#login.state !== 'ok') {
      throw new JuejinReviewError('no_cookie', 'A valid Juejin login cookie is required to post replies');
    }
    if (!this.#options.config.articles.includes(draft.articleId)) {
      throw new JuejinReviewError('send_disabled', `Juejin article ${draft.articleId} is no longer in the articles whitelist`);
    }
    const invalid = validateReplyText(draft.message);
    if (invalid) throw new JuejinReviewError('invalid_message', invalid);
    const wait = this.#lastSentAt + this.#options.config.minSendIntervalMs - this.#now;
    if (this.#lastSentAt > 0 && wait > 0) {
      throw new JuejinReviewError('rate_limited', `Wait ${Math.ceil(wait / 1000)}s before sending another reply`, wait);
    }
    this.drafts.update(id, { status: 'sending' }, this.#now);
    this.#lastSentAt = this.#now;
    try {
      const replyId = await this.replyComment({
        articleId: draft.articleId,
        root: draft.root,
        parent: draft.parent,
        message: draft.message,
      });
      if (replyId) this.#markSeen(replyId);
      this.drafts.discard(id);
      this.#logger.info(formatCompact({ op: 'juejin_draft_sent', draft: id, target: draft.target, reply: replyId }));
      return Object.freeze({ draft, ...(replyId ? { replyId } : {}) });
    } catch (error) {
      const ambiguous = error instanceof JuejinApiError && error.ambiguous;
      this.drafts.update(id, { status: 'pending', ...(ambiguous ? { interrupted: true } : {}) }, this.#now);
      this.#handleError('send', error);
      if (error instanceof JuejinApiError && error.risk) {
        throw new JuejinReviewError('circuit_open', `Juejin risk control (${error.code}); endpoint stopped, draft kept`);
      }
      if (ambiguous) {
        throw new JuejinReviewError('unknown_outcome', 'Juejin did not confirm the reply; it may have been posted. Check the article before sending again');
      }
      if (error instanceof JuejinApiError && error.loginRequired) {
        throw new JuejinReviewError('no_cookie', 'Juejin login expired; update the cookie, draft kept');
      }
      throw new JuejinReviewError('platform_error', error instanceof Error ? error.message : String(error));
    }
  }
}
