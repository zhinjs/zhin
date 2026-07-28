/**
 * Milky WS client endpoint — outbound connect to Milky protocol server.
 */
import WebSocket from 'ws';
import {
  createEndpointLifecycle,
  type EndpointConnectHandle,
  type EndpointInstance,
  type EndpointLifecycle,
  type EndpointManagement,
} from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { createMilkyEndpointManagement } from './endpoint-management.js';
import { registerMilkyAgentEndpoint } from './milky-agent-deps.js';
import {
  buildSendAction,
  buildWsConnectOptions,
  callApi,
  extractInboundAudioUrl,
  formatInboundContent,
  formatInboundMessageId,
  formatInboundTarget,
  formatOutboundMessageId,
  formatOutboundSegments,
  isMentioned,
  parseMessageReceiveData,
  parseMilkyMessageId,
  senderNickname,
  type MilkyEvent,
  type MilkyIncomingMessage,
  type MilkyWsConfig,
} from './protocol.js';
import type { MilkyWsCreateOptions, MilkyWsSocket } from './ws-types.js';

const logger = getLogger('milky');
const WS_OPEN = 1;

export interface MilkyWsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: MilkyWsConfig;
  readonly createWebSocket?: (
    url: string,
    options: MilkyWsCreateOptions,
  ) => MilkyWsSocket;
  readonly callApi?: typeof callApi;
}

export class MilkyWsEndpoint implements EndpointInstance {
  readonly #options: MilkyWsEndpointOptions;
  readonly #callApi: typeof callApi;
  readonly management: EndpointManagement = createMilkyEndpointManagement(this);
  readonly #lifecycle: EndpointLifecycle;
  #ws?: MilkyWsSocket;
  #open = false;
  #unregisterAgent?: () => void;

  constructor(options: MilkyWsEndpointOptions) {
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
      // start 失败复位由基座保证；agent 注册/反注册是适配器专有依赖，留在适配器侧
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
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = undefined;
    }
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
    }));
    return messageId;
  }

  /** Public API for agent tools / callers. */
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

  /** Test / internal: admit a parsed event when the endpoint is open. */
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
    const nickname = senderNickname(data);
    const mentioned = isMentioned(data, event.self_id);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender: String(data.sender_id),
      id: formatInboundMessageId(data),
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
          logger.warn(formatCompact({
            endpoint: this.#options.config.name,
            ok: false,
            error: 'missing access_token',
          }));
        }
        logger.debug(formatCompact({
          endpoint: this.#options.config.name,
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

      ws.on('message', (data) => {
        this.#onMessage(data);
      });

      ws.on('close', (code, reason) => {
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
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#options.config.name,
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
        logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: this.#options.config.name,
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

  #onMessage(data: unknown): void {
    try {
      const raw = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString()
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data ?? '');
      const event = JSON.parse(raw) as MilkyEvent;
      this.admit(event);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'milky_parse_failed',
        endpoint: this.#options.config.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
