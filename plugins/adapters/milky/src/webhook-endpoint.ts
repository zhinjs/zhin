/**
 * Milky webhook endpoint — httpHostToken POST inbound + baseUrl HTTP API outbound.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { readRequestBody, verifyMilkyAccessToken } from './milky-auth.js';
import { registerMilkyAgentEndpoint } from './milky-agent-deps.js';
import {
  buildSendAction,
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
  type MilkyWebhookConfig,
} from './protocol.js';

const logger = getLogger('milky');

export interface MilkyWebhookEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly config: MilkyWebhookConfig;
  readonly callApi?: typeof callApi;
}

export class MilkyWebhookEndpoint implements EndpointInstance {
  readonly #options: MilkyWebhookEndpointOptions;
  readonly #callApi: typeof callApi;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: MilkyWebhookEndpointOptions) {
    this.#options = options;
    this.#callApi = options.callApi ?? callApi;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unregisterAgent = registerMilkyAgentEndpoint(this.#options.config.name, this);
    this.#setupRoutes();
    logger.info(formatCompact({
      op: 'listen',
      endpoint: this.#options.config.name,
      mode: 'webhook',
      path: this.#options.config.path,
    }));
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
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

  #setupRoutes(): void {
    const path = this.#options.config.path;
    this.#routeReleases.push(
      this.#options.http.route('POST', path, async (request, response) => {
        await this.#handleWebhook(request, response);
      }, { summary: 'Milky webhook callback', tags: ['milky'] }),
    );
  }

  async #handleWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!verifyMilkyAccessToken(this.#options.config.access_token, request)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }
      const raw = await readRequestBody(request);
      let event: MilkyEvent;
      try {
        event = JSON.parse(raw) as MilkyEvent;
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Invalid JSON' }));
        return;
      }
      if (this.#open) this.admit(event);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    } catch (error) {
      logger.error('Milky webhook error:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Internal Server Error' }));
      }
    }
  }
}
