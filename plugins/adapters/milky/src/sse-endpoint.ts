/**
 * Milky SSE client endpoint — GET text/event-stream on /event.
 */
import {
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointInstance,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
} from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { createMilkyEndpointManagement } from './endpoint-management.js';
import { registerMilkyAgentEndpoint } from './milky-agent-deps.js';
import {
  buildSendAction,
  buildSseConnectOptions,
  callApi,
  extractInboundAudioUrl,
  formatInboundContent,
  formatInboundMessageId,
  formatInboundSegments,
  formatOutboundMessageId,
  formatOutboundSegments,
  isMentioned,
  milkyInboundConversation,
  parseMessageReceiveData,
  parseMilkyMessageId,
  senderNickname,
  type MilkyEvent,
  type MilkyIncomingMessage,
  type MilkySseConfig,
} from './protocol.js';
import { openSseStream, type SseClientHandle } from './sse-client.js';

const logger = getLogger('milky');

export type CreateMilkySseStream = (options: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly onMessage: (data: string) => void;
  readonly onError?: (error: Error) => void;
  readonly onOpen?: () => void;
}) => SseClientHandle;

export interface MilkySseEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: MilkySseConfig;
  readonly createSseStream?: CreateMilkySseStream;
  readonly callApi?: typeof callApi;
}

export class MilkySseEndpoint implements EndpointInstance {
  readonly #options: MilkySseEndpointOptions;
  readonly #callApi: typeof callApi;
  readonly management: EndpointManagement = createMilkyEndpointManagement(this);
  readonly #lifecycle: EndpointLifecycle;
  #stream?: SseClientHandle;
  #open = false;
  #unregisterAgent?: () => void;

  constructor(options: MilkySseEndpointOptions) {
    this.#options = options;
    this.#callApi = options.callApi ?? callApi;
    this.#lifecycle = createEndpointLifecycle({
      name: options.config.name,
      // reconnect_interval 旧语义为固定间隔：multiplier 1 + 无 jitter + 不封顶
      reconnect: {
        initialIntervalMs: options.config.reconnect_interval,
        multiplier: 1,
        maxIntervalMs: Number.MAX_SAFE_INTEGER,
        jitterMs: 0,
      },
    });
  }

  async start(): Promise<void> {
    if (this.#lifecycle.started) return;
    this.#unregisterAgent = registerMilkyAgentEndpoint(this.#options.config.name, this);
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
    } catch (err) {
      // 与 WS 对齐：start 失败复位由基座保证；agent 反注册留在适配器侧，允许重试
      this.#unregisterAgent?.();
      this.#unregisterAgent = undefined;
      throw err;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    await this.#lifecycle.stop();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#stream?.close();
    this.#stream = undefined;
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await this.callApi(action, params) as { message_seq?: number } | undefined;
    const messageId = formatOutboundMessageId(conversation, data?.message_seq);
    logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.name,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
      mode: 'sse',
    }));
    return messageId;
  }

  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.#callApi(this.apiOptions(), action, params);
  }

  async recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await this.callApi('recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await this.callApi('recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  async kickMember(groupId: number, userId: number, rejectAddRequest = false): Promise<boolean> {
    await this.callApi('kick_group_member', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
    return true;
  }

  async muteMember(groupId: number, userId: number, duration = 600): Promise<boolean> {
    await this.callApi('set_group_member_mute', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
    return true;
  }

  async muteAll(groupId: number, enable = true): Promise<boolean> {
    await this.callApi('set_group_whole_mute', { group_id: groupId, is_mute: enable });
    return true;
  }

  async setAdmin(groupId: number, userId: number, enable = true): Promise<boolean> {
    await this.callApi('set_group_member_admin', {
      group_id: groupId,
      user_id: userId,
      is_set: enable,
    });
    return true;
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    await this.callApi('set_group_member_card', {
      group_id: groupId,
      user_id: userId,
      card,
    });
    return true;
  }

  async setTitle(groupId: number, userId: number, title: string): Promise<boolean> {
    await this.callApi('set_group_member_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
    });
    return true;
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    await this.callApi('set_group_name', { group_id: groupId, new_group_name: name });
    return true;
  }

  async getMemberList(groupId: number): Promise<unknown[]> {
    return this.callApi('get_group_member_list', { group_id: groupId }) as Promise<unknown[]>;
  }

  async getGroupInfo(groupId: number): Promise<unknown> {
    return this.callApi('get_group_info', { group_id: groupId });
  }

  admit(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (!this.#open || !data) return;
    this.#admitMessage(data, event);
  }

  apiOptions(): { baseUrl: string; access_token?: string } {
    return {
      baseUrl: this.#options.config.baseUrl,
      access_token: this.#options.config.access_token,
    };
  }

  #admitMessage(data: MilkyIncomingMessage, event: MilkyEvent): void {
    const conversation = milkyInboundConversation(String(this.#options.id), data);
    const target = `${conversation.kind}:${conversation.id}`;
    const content = formatInboundContent(data);
    const segments = formatInboundSegments(data);
    const audioUrl = extractInboundAudioUrl(data);
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: formatInboundMessageId(data) },
      content,
      segments,
      sender: String(data.sender_id),
      metadata: Object.freeze({
        message_scene: data.message_scene,
        peer_id: String(data.peer_id),
        sender_id: String(data.sender_id),
        message_seq: data.message_seq,
        endpoint: this.#options.config.name,
        time: data.time ?? event.time,
        self_id: event.self_id != null ? String(event.self_id) : undefined,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
        ...(audioUrl ? { audio_url: audioUrl } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'milky_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #connect(handle: EndpointConnectHandle): Promise<void> {
    const { url, headers, safeUrl } = buildSseConnectOptions(this.#options.config);
    const create = this.#options.createSseStream ?? ((opts) => openSseStream(opts));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const stream = create({
        url,
        headers,
        onOpen: () => {
          if (settled) return;
          settled = true;
          logger.debug(formatCompact({
            endpoint: this.#options.config.name,
            mode: 'sse',
            url: safeUrl,
          }));
          resolve();
        },
        onMessage: (data) => this.#onMessage(data),
        onError: (error) => {
          logger.warn(formatCompact({
            op: 'sse_error',
            endpoint: this.#options.config.name,
            ok: false,
            error: error.message,
          }));
          if (!settled) {
            settled = true;
            reject(error);
          }
        },
      });
      this.#stream = stream;
      handle.onForceClose(() => {
        try {
          stream.close();
        } catch {
          /* ignore */
        }
      });
      void stream.closed.then(() => {
        // stop-during-connect 竞态由基座静默 settle（主动停止不算失败），此处仅对运行期断开告警
        if (this.#lifecycle.state !== 'stopped') {
          logger.warn(formatCompact({
            op: 'disconnect',
            endpoint: this.#options.config.name,
            mode: 'sse',
            reconnect_ms: this.#options.config.reconnect_interval,
          }));
        }
        // 基座语义：仅曾 open 的连接才武装重连；初始连接失败由 start() 的 catch 复位
        handle.notifyClosed(new Error('Milky SSE closed'));
        if (!settled) {
          settled = true;
          reject(new Error('Milky SSE closed before open'));
        }
      });
    });
  }

  #onMessage(data: string): void {
    try {
      const event = JSON.parse(data) as MilkyEvent;
      this.admit(event);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'milky_parse_failed',
        endpoint: this.#options.config.name,
        mode: 'sse',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
