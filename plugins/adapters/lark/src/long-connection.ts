import type { LarkCardAction } from './cards.js';
import * as lark from '@larksuiteoapi/node-sdk';
import { createLarkStreamAgent } from './stream-proxy.js';
import type { LarkMessage, ResolvedLarkConfig } from './protocol.js';

export interface LarkLongConnection {
  /** Resolves only after the transport handshake, never merely after SDK start(). */
  connect(): Promise<void>;
  close(): void;
}
export interface LarkLongConnectionOptions {
  readonly config: ResolvedLarkConfig;
  readonly receive: (message: LarkMessage) => void;
  readonly cardAction?: (event: LarkCardAction) => void;
  readonly disconnected: () => void;
}
export type LarkLongConnectionFactory = (options: LarkLongConnectionOptions) => LarkLongConnection;

/** The SDK owns wire framing / acknowledgements / ping; Zhin owns reconnect. */
export const createLarkLongConnection: LarkLongConnectionFactory = ({ config, receive, cardAction, disconnected }) => {
  let cancelled = false;
  let ready = false;
  let settleReady!: () => void;
  let settleError!: (error: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    settleError = reject;
  });
  // close-before-connect must never create an unhandled rejection.
  connected.catch(() => {});
  const agent = config.streamProxy ? createLarkStreamAgent(config.streamProxy) : undefined;
  const client = new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    agent,
    domain: config.isFeishu ? lark.Domain.Feishu : lark.Domain.Lark,
    autoReconnect: false,
    loggerLevel: lark.LoggerLevel.error,
    onReady: () => {
      if (cancelled) { client.close({ force: true }); return; }
      ready = true;
      settleReady();
    },
    onError: () => {
      if (cancelled) return;
      if (ready) disconnected();
      else settleError(new Error('Lark long connection failed'));
    },
  });
  const dispatcher = new lark.EventDispatcher({}).register({
    'card.action.trigger': (event: LarkCardAction) => { if (!cancelled) cardAction?.(event as LarkCardAction); return {}; },
    'im.message.receive_v1': (event) => {
      if (!cancelled) receive({ ...event.message, sender: event.sender });
      // No downstream send is awaited: SDK ACK remains within its 3-second window.
    },
  });
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  return {
    async connect() {
      if (cancelled) throw new Error('Lark long connection stopped');
      const deadline = setTimeout(() => settleError(new Error('Lark long connection handshake timed out')), 30_000);
      try {
        await client.start({ eventDispatcher: dispatcher });
        await connected;
        if (cancelled) { client.close({ force: true }); return; }
        healthTimer = setInterval(() => {
          if (!cancelled && ready && client.getConnectionStatus().state !== 'connected') {
            ready = false;
            disconnected();
          }
        }, 1_000);
        healthTimer.unref();
      } catch (error) {
        client.close({ force: true });
        agent?.destroy();
        throw error;
      } finally { clearTimeout(deadline); }
    },
    close() {
      cancelled = true;
      if (healthTimer) clearInterval(healthTimer);
      settleError(new Error('Lark long connection stopped'));
      client.close({ force: true });
      agent?.destroy();
    },
  };
};
