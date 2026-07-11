/**
 * Socket Mode 传输 — 包装 @slack/socket-mode SocketModeClient
 */
import { SocketModeClient } from '@slack/socket-mode';
import type { SlackEventDispatcher } from './event-dispatcher.js';
import type { SlackEndpointConfig, SlackEventEnvelope, SlackInteractionPayload, SlackSlashCommand } from './types.js';
import type { Logger } from '@zhin.js/logger';

export class SlackSocketTransport {
  private socketClient: SocketModeClient;
  private connected = false;

  constructor(
    private config: SlackEndpointConfig,
    private dispatcher: SlackEventDispatcher,
    private logger: Logger,
  ) {
    if (!config.appToken) {
      throw new Error('Socket Mode requires appToken (xapp-...)');
    }
    this.socketClient = new SocketModeClient({
      appToken: config.appToken,
      clientPingTimeout: config.clientPingTimeout ?? 15_000,
    });
  }

  async connect(): Promise<void> {
    this.socketClient.on('slack_event', async ({ ack, body }) => {
      await ack();
      this.handleEnvelope(body);
    });

    this.socketClient.on('interactive', async ({ ack, body }) => {
      await ack();
      this.handleInteraction(body);
    });

    this.socketClient.on('slash_commands', async ({ ack, body }) => {
      await ack();
      this.handleSlashCommand(body);
    });

    await this.socketClient.start();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.socketClient.disconnect();
    } catch { /* ignore */ }
    this.connected = false;
  }

  get isConnected(): boolean { return this.connected; }

  private handleEnvelope(body: unknown): void {
    const envelope = body as SlackEventEnvelope;
    if (envelope?.type === 'event_callback' && envelope.event) {
      this.dispatcher.routeEvent(envelope.event);
    }
  }

  private handleInteraction(body: unknown): void {
    const payload = body as SlackInteractionPayload;
    if (payload?.type) {
      this.dispatcher.routeInteraction(payload);
    }
  }

  private handleSlashCommand(body: unknown): void {
    const cmd = body as SlackSlashCommand;
    if (cmd?.command) {
      this.dispatcher.routeSlashCommand(cmd);
    }
  }
}
