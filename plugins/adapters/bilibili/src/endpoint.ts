/**
 * BilibiliEndpoint — 白名单视频评论只读轮询 + 草稿出站（Experimental）。
 *
 * - 入站：轮询 `x/v2/reply`，首轮只建基线；新评论按「评论楼」归 conversation 后 emit `message.receive`。
 * - 出站：`send()` 默认只把回复放进草稿队列（review），不会调用平台写接口。
 * - 风控错误码立即熔断，停止轮询，不自动重试。
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
  parseThreadConversationId,
  threadRootOf,
  type BilibiliReply,
  type ResolvedBilibiliConfig,
} from './protocol.js';

const SEEN_CAPACITY = 5_000;

export interface BilibiliEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedBilibiliConfig;
  readonly fetch?: BilibiliFetch;
  /** 轮询抖动随机源（测试注入）。 */
  readonly random?: () => number;
  /** 关闭自动定时轮询（测试中手动调用 pollOnce）。 */
  readonly autoPoll?: boolean;
}

export class BilibiliEndpoint extends Endpoint<BilibiliClient> {
  readonly client: BilibiliClient;
  readonly drafts = new BilibiliDraftQueue();
  readonly #options: BilibiliEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #aids: string[] = [];
  readonly #baselined = new Set<string>();
  readonly #seen = new Set<string>();
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
          await this.#admit(aid, reply, page.upper?.mid);
        }
      } catch (error) {
        this.#handleError('poll', error, aid);
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

  async #admit(aid: string, reply: BilibiliReply, upperMid: number | undefined): Promise<void> {
    if (!this.#open) return;
    const mid = String(reply.mid);
    if (this.#selfMid && mid === this.#selfMid) return; // 防自回环
    const conversation = bilibiliThreadConversation(String(this.#options.id), aid, threadRootOf(reply));
    void this.emitPlatform('reply', reply).catch(() => undefined);
    await this.emit('message.receive', {
      conversation,
      message: { conversation, id: String(reply.rpid) },
      content: reply.content?.message ?? '',
      sender: { id: mid, name: reply.member?.uname ?? mid },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        resource: Object.freeze({ type: 'video', oid: aid }),
        rootId: threadRootOf(reply),
        parentId: String(reply.parent || reply.rpid),
        createdAt: reply.ctime * 1000,
        likeCount: reply.like ?? 0,
        isUploader: upperMid !== undefined && Number(reply.mid) === Number(upperMid),
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
   * 出站 = 回复评论楼。v1 默认 review：只进草稿队列，返回 not_sent（approval_pending），不调用平台写接口。
   */
  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const thread = parseThreadConversationId(conversation.id);
    if (!thread) {
      throw new EndpointDeliveryError('invalid_recipient',
        `Bilibili conversation must be video:<aid>:<rootRpid>, got "${conversation.id}"`, 'not_sent');
    }
    const message = formatOutboundText(payload);
    if (!message) throw new EndpointDeliveryError('invalid_payload', 'Empty Bilibili reply', 'not_sent');
    if ([...message].length > BILIBILI_COMMENT_MAX_LENGTH) {
      throw new EndpointDeliveryError('invalid_payload',
        `Bilibili reply exceeds ${BILIBILI_COMMENT_MAX_LENGTH} characters`, 'not_sent');
    }
    if (this.#options.config.sendMode === 'off') {
      throw new EndpointDeliveryError('send_disabled', 'Bilibili sendMode is off', 'not_sent');
    }
    const draft: BilibiliReplyDraft = this.drafts.add({
      oid: thread.oid,
      root: thread.root,
      parent: thread.root,
      message,
    });
    this.#logger.info(formatCompact({ op: 'bilibili_draft_queued', draft: draft.id, target: conversation.id }));
    throw new EndpointDeliveryError('approval_pending',
      `Reply queued as draft ${draft.id}; review before sending`, 'not_sent');
  }
}
