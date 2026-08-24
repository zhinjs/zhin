/**
 * Milky WS client endpoint — outbound connect to Milky protocol server.
 */
import WebSocket from 'ws';
import {
  ClientEndpoint,
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
import {
  callMilkyClient,
  createMilkyEndpointClient,
  forwardMilkyClientEvents,
  type MilkyClient,
} from './client.js';
import {
  buildSendAction,
  buildWsConnectOptions,
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
  type MilkyWsConfig,
} from './protocol.js';
import type { MilkyWsCreateOptions, MilkyWsSocket } from './ws-types.js';

const WS_OPEN = 1;

export interface MilkyWsEndpointOptions {
  readonly id: CapabilityId;
  readonly config: MilkyWsConfig;
  readonly createWebSocket?: (
    url: string,
    options: MilkyWsCreateOptions,
  ) => MilkyWsSocket;
  readonly callApi?: typeof callApi;
}

export class MilkyWsEndpoint extends ClientEndpoint<MilkyClient> {
  readonly client: MilkyClient;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: MilkyWsEndpointOptions;
  readonly #callApi: typeof callApi;
  readonly management: EndpointManagement;
  readonly control: EndpointControl = createRecallEndpointControl((id) => this.recallMessage(id));
  readonly #lifecycle: EndpointLifecycle;
  #ws?: MilkyWsSocket;
  #clientSocketRelease?: () => void;

  constructor(options: MilkyWsEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('milky', options.config.id);
    this.#options = options;
    this.#callApi = options.callApi ?? callApi;
    this.client = createMilkyEndpointClient(options.config, this.#callApi);
    this.management = createMilkyEndpointManagement({
      callApi: (action, params) => callMilkyClient(this.client, action, params),
    });
    this.bindClientEvents(
      (receive) => forwardMilkyClientEvents(this.client, receive),
      (name, payload) => {
        if (name === 'event') this.#admitRaw(payload as MilkyEvent);
      },
      (_name, error) => this.#warnPlatformEvent(error),
    );
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

  async start(): Promise<void> {
    if (this.#lifecycle.started) return;
    await this.#lifecycle.start((handle) => this.#connect(handle));
  }

  close(): void {
    super.close();
    this.#clientSocketRelease?.();
    this.#clientSocketRelease = undefined;
  }

  async stop(): Promise<void> {
    this.close();
    await this.#lifecycle.stop();
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = undefined;
    }
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(conversation, message);
    const data = await callMilkyClient<{ message_seq?: number }>(this.client, action, params);
    const messageId = formatOutboundMessageId(conversation, data?.message_seq);
    this.#logger.debug(formatCompact({
      op: 'milky_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId,
    }));
    return messageId;
  }

  async recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await callMilkyClient(this.client, 'recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await callMilkyClient(this.client, 'recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  #admitRaw(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (!data) return;
    this.#admitMessage(data, event);
  }

  #warnPlatformEvent(error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'milky_platform_event_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  #admitMessage(data: MilkyIncomingMessage, event: MilkyEvent): void {
    const conversation = milkyInboundConversation(String(this.#options.id), data);
    const target = `${conversation.kind}:${conversation.id}`;
    const content = formatInboundContent(data);
    const segments = formatInboundSegments(data);
    const audioUrl = extractInboundAudioUrl(data);
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this.emit('message.receive', {
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
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: MilkyWsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as MilkyWsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.#ws = ws;
      handle.onForceClose(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        if (!this.#options.config.access_token) {
          this.#logger.warn(formatCompact({
            endpoint: this.#options.config.id,
            ok: false,
            error: 'missing access_token',
          }));
        }
        this.#logger.debug(formatCompact({
          endpoint: this.#options.config.id,
          mode: 'ws',
          url: safeUrl,
        }));
        // stop-during-connect 竞态：已停止则不再武装心跳（基座 stop 已清理定时器）
        if (this.#lifecycle.started) {
          this.#lifecycle.startHeartbeat(() => {
            try {
              if (ws.readyState === WS_OPEN) ws.ping?.();
            } catch {
              /* ignore */
            }
          }, this.#options.config.heartbeat_interval);
        }
        resolve();
      });

      this.#clientSocketRelease?.();
      this.#clientSocketRelease = this.client.acceptWebSocket(ws);

      ws.on('close', (code, reason) => {
        this.#clientSocketRelease?.();
        this.#clientSocketRelease = undefined;
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        const codeHint = codeNum === 1005
          ? ' [无状态，多为服务端/代理未发 close 帧即断开]'
          : codeNum === 1006
            ? ' [异常关闭]'
            : '';
        this.#logger.warn(formatCompact({
          op: 'disconnect',
          code: codeNum,
          error: `${reasonStr || 'closed'}${codeHint}`,
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        // 基座语义：仅曾 open 的连接才武装重连；初始连接失败由 start() 的 catch 复位
        handle.notifyClosed(new Error(`Milky WS 关闭: ${codeNum} ${reasonStr}`));
        if (!settled) {
          settled = true;
          reject(new Error(`Milky WS 关闭: ${codeNum} ${reasonStr}`));
        }
      });

      ws.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: this.#options.config.id,
          ok: false,
          error: error.message,
        }));
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

}
