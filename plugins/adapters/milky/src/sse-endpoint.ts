/**
 * Milky SSE client endpoint — GET text/event-stream on /event.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerMilkyAgentEndpoint } from './milky-agent-deps.js';
import {
  buildSendAction,
  buildSseConnectOptions,
  callApi,
  extractInboundAudioUrl,
  formatInboundContent,
  formatInboundMessageId,
  formatInboundTarget,
  formatOutboundMessageId,
  formatOutboundSegments,
  parseMessageReceiveData,
  parseMilkyMessageId,
  senderDisplayName,
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
  #stream?: SseClientHandle;
  #reconnectTimer?: NodeJS.Timeout;
  #open = false;
  #started = false;
  #stopping = false;
  #unregisterAgent?: () => void;

  constructor(options: MilkySseEndpointOptions) {
    this.#options = options;
    this.#callApi = options.callApi ?? callApi;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    this.#unregisterAgent = registerMilkyAgentEndpoint(this.#options.config.name, this);
    await this.#connect();
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#stopping = true;
    this.#started = false;
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#stream?.close();
    this.#stream = undefined;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name, mode: 'sse' }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(target, message);
    const data = await this.callApi(action, params) as { message_seq?: number } | undefined;
    const messageId = formatOutboundMessageId(target, data?.message_seq);
    logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.name,
      target,
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
    const target = formatInboundTarget(data);
    const content = formatInboundContent(data);
    const audioUrl = extractInboundAudioUrl(data);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender: senderDisplayName(data),
      id: formatInboundMessageId(data),
      metadata: Object.freeze({
        message_scene: data.message_scene,
        peer_id: String(data.peer_id),
        sender_id: String(data.sender_id),
        message_seq: data.message_seq,
        endpoint: this.#options.config.name,
        time: data.time ?? event.time,
        self_id: event.self_id != null ? String(event.self_id) : undefined,
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

  async #connect(): Promise<void> {
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
      void stream.closed.then(() => {
        if (this.#stopping) return;
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#options.config.name,
          mode: 'sse',
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        if (!settled) {
          settled = true;
          reject(new Error('Milky SSE closed before open'));
        }
        this.#scheduleReconnect();
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

  #scheduleReconnect(): void {
    if (this.#stopping || !this.#started || this.#reconnectTimer) return;
    const delay = this.#options.config.reconnect_interval;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect().catch((err) => {
        logger.warn(formatCompact({
          op: 'reconnect',
          endpoint: this.#options.config.name,
          mode: 'sse',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }, delay);
  }
}
