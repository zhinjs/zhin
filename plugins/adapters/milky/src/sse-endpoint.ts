/**
 * Milky SSE client endpoint — GET text/event-stream on /event.
 */
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification,
  createRecallEndpointControl,
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointControl,
  type EndpointLifecycle,
  type EndpointManagement,
  type EndpointSendRequest,
} from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { createMilkyEndpointManagement } from './endpoint-management.js';
import { callMilkyClient, milkyClientOptions, forwardMilkyClientEvents, MilkyClient } from './client.js';
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

export type CreateMilkySseStream = (options: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly onMessage: (data: string) => void;
  readonly onError?: (error: Error) => void;
  readonly onOpen?: () => void;
}) => SseClientHandle;

export interface MilkySseEndpointOptions {
  readonly id: CapabilityId;
  readonly signal?: AbortSignal;
  readonly config: MilkySseConfig;
  readonly createSseStream?: CreateMilkySseStream;
  readonly callApi?: typeof callApi;
}

export class MilkySseEndpoint extends MilkyClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  #open = false;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: MilkySseEndpointOptions;
  readonly #management: EndpointManagement;
  readonly #control: EndpointControl = createRecallEndpointControl((id) => this.#recallMessage(id));
  readonly #lifecycle: EndpointLifecycle;
  #stream?: SseClientHandle;

  constructor(options: MilkySseEndpointOptions) {
    super(milkyClientOptions(options.config, options.callApi ?? callApi, options.signal));
    this.#logger = getAdapterLogger('milky', options.config.id);
    this.#options = options;
    this.#management = createMilkyEndpointManagement({
      callApi: (action, params) => callMilkyClient(this, action, params),
    });
    const readTransportState = () => this.#lifecycle.state;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.config.id,
      start: () => this.#start(), open: () => { this.#open = true; },
      close: () => { this.#open = false; }, stop: () => this.#stop(),
      send: request => this.#send(request),
      management: this.#management, control: this.#control,
      get transportState() { return readTransportState(); },
    });
    forwardMilkyClientEvents(this, (name, payload) => {
      void this[endpointSpec].events.run(() => {
        if (!this.#open && !this.#lifecycle.started) return;
        void this[endpointSpec].events.platform(name, payload).catch(error => this.#warnPlatformEvent(error));
        if (name === 'event') this.#admitRaw(payload as MilkyEvent);
      }).catch(error => this.#warnPlatformEvent(error));
    });
    this.#lifecycle = createEndpointLifecycle({
      name: options.config.id,
      // reconnect_interval 旧语义为固定间隔：multiplier 1 + 无 jitter + 不封顶
      reconnect: {
        initialIntervalMs: options.config.reconnect_interval,
        multiplier: 1,
        maxIntervalMs: Number.MAX_SAFE_INTEGER,
        jitterMs: 0,
      },
    });
  }

  async #start(): Promise<void> {
    if (this.#lifecycle.started) return;
    try {
      await this.#lifecycle.start((handle) => this.#connect(handle));
    } catch (err) {
      // 与 WS 对齐：start 失败复位由基座保证；agent 反注册留在适配器侧，允许重试
      throw err;
    }
  }

  async #stop(): Promise<void> {
    this.#open = false;
    await this.#lifecycle.stop();
    this.#stream?.close();
    this.#stream = undefined;
  }

  async #send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await callMilkyClient<{ message_seq?: number }>(this, action, params);
    const messageId = formatOutboundMessageId(conversation, data?.message_seq);
    this.#logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
      mode: 'sse',
    }));
    return messageId;
  }

  async #recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await callMilkyClient(this, 'recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await callMilkyClient(this, 'recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  #admitRaw(event: MilkyEvent): void {
    if (event.self_id != null) this[endpointSpec].reportSelfUserId(String(event.self_id));
    const data = parseMessageReceiveData(event);
    if (!data) return;
    this.#admitMessage(data, event);
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({ op: 'milky_platform_event_failed', error: error instanceof Error ? error.message : String(error) }));
  }

  #admitMessage(data: MilkyIncomingMessage, event: MilkyEvent): void {
    const conversation = { ...milkyInboundConversation(String(this.#options.id), data), endpoint: this[endpointSpec].identity };
    const target = `${conversation.kind}:${conversation.id}`;
    const content = formatInboundContent(data);
    const segments = formatInboundSegments(data);
    const audioUrl = extractInboundAudioUrl(data);
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this[endpointSpec].events.message({
      event,
      ...(typeof event.time === 'number' ? { platformSentAt: event.time * 1000 } : {}),
      conversation,
      message: { conversation, id: formatInboundMessageId(data) },
      content,
      segments,
      sender: { id: String(data.sender_id), name: nickname },
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        message_scene: data.message_scene,
        peer_id: String(data.peer_id),
        sender_id: String(data.sender_id),
        message_seq: data.message_seq,
        time: data.time ?? event.time,
        self_id: event.self_id != null ? String(event.self_id) : undefined,
        ...(nickname ? { nickname } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
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
          this.#logger.debug(formatCompact({
            endpoint: this.#options.config.id,
            mode: 'sse',
            url: safeUrl,
          }));
          resolve();
        },
        onMessage: (data) => this.#onMessage(data),
        onError: (error) => {
          this.#logger.warn(formatCompact({
            op: 'sse_error',
            endpoint: this.#options.config.id,
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
          this.#logger.warn(formatCompact({
          op: 'disconnect',
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
      this.ingest(event as Parameters<MilkyClient['ingest']>[0]);
    } catch (error) {
      this.#logger.warn(formatCompact({
        op: 'milky_parse_failed',
        endpoint: this.#options.config.id,
        mode: 'sse',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
