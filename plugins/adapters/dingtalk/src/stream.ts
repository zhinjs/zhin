import { createDingTalkStreamSocket } from './stream-proxy.js';
import { createEndpointLifecycle } from 'zhin.js/adapter';
import type { DingTalkFetch } from './endpoint.js';
import type { DingTalkEvent, ResolvedDingTalkConfig } from './protocol.js';

export const CARD_TOPIC = '/v1.0/card/instances/callback';
export const ROBOT_TOPIC = '/v1.0/im/bot/messages/get';
export interface DingTalkStreamSocket {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(data: string): void;
  terminate(): void;
  ping(): void;
}
export type DingTalkStreamSocketFactory = (url: string) => DingTalkStreamSocket;

/** Official gateway wire contract; reconnect/heartbeat belong to the shared lifecycle. */
export class DingTalkStream {
  readonly lifecycle;
  #active?: AbortController;
  #socket?: DingTalkStreamSocket;
  #seen = new Map<string, number>();
  #pending = new Set<string>();
  constructor(
    readonly config: ResolvedDingTalkConfig,
    readonly fetch: DingTalkFetch,
    readonly admit: (event: DingTalkEvent) => Promise<void>,
    readonly isOpen: () => boolean,
    readonly createSocket: DingTalkStreamSocketFactory = (url) => createDingTalkStreamSocket(url, config.streamProxy),
    readonly admitCard?: (event: import('./cards.js').DingTalkCardCallback, id: string) => Promise<void>,
  ) {
    this.lifecycle = createEndpointLifecycle({ name: config.id, heartbeat: { intervalMs: 30_000, watchdogMisses: 2 } });
  }
  async start(): Promise<void> {
    await this.lifecycle.start(async (handle) => {
      const controller = new AbortController();
      this.#active = controller;
      const transport: { socket?: DingTalkStreamSocket } = {};
      handle.onForceClose(() => { controller.abort(); transport.socket?.terminate(); });
      const response = await this.fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: this.config.appKey, clientSecret: this.config.appSecret,
          subscriptions: [{ type: 'CALLBACK', topic: ROBOT_TOPIC }, ...(this.admitCard && this.config.cardTemplateId ? [{ type: 'CALLBACK', topic: CARD_TOPIC }] : [])], ua: 'zhin.js' }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error(`DingTalk Stream gateway HTTP ${response.status}`);
      const gateway = await response.json() as { endpoint?: string; ticket?: string };
      if (controller.signal.aborted) return;
      if (!gateway.endpoint || !gateway.ticket) throw new Error('Invalid DingTalk Stream gateway response');
      const url = new URL(gateway.endpoint);
      if (url.protocol !== 'wss:') throw new Error('DingTalk Stream requires WSS');
      url.searchParams.set('ticket', gateway.ticket);
      const current = this.createSocket(url.toString());
      transport.socket = current;
      this.#socket = current;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { current.terminate(); reject(new Error('DingTalk Stream connection timeout')); }, 30_000);
        const clear = () => clearTimeout(timer);
        controller.signal.addEventListener('abort', clear, { once: true });
        current.on('open', () => {
          if (controller.signal.aborted || this.#socket !== current) { current.terminate(); return; }
          clear(); this.lifecycle.startHeartbeat(() => current.ping()); resolve();
        });
        current.on('error', () => { clear(); current.terminate(); reject(new Error('DingTalk Stream transport error')); });
        current.on('close', () => { clear(); if (this.#socket === current) this.#socket = undefined;
          handle.notifyClosed('transport closed'); reject(new Error('DingTalk Stream closed before connection')); });
        current.on('pong', () => { if (!controller.signal.aborted) this.lifecycle.notifyHeartbeatAck(); });
        current.on('message', (raw: { toString(): string }) => {
          if (controller.signal.aborted || this.#socket !== current) return;
          this.lifecycle.notifyHeartbeatAck();
          let frame: { type?: string; headers?: { topic?: string; messageId?: string }; data?: string };
          try { frame = JSON.parse(raw.toString()); } catch { return; }
          if (frame.type === 'SYSTEM') {
            // REGISTERED is optional; successful WSS handshake already establishes the subscribed transport.
            if (frame.headers?.topic === 'ping' || frame.headers?.topic === 'disconnect') {
              current.send(JSON.stringify({ code: 200, headers: frame.headers, message: 'OK', data: frame.data }));
              if (frame.headers.topic === 'disconnect') current.terminate();
            }
            return;
          }
          if (frame.type !== 'CALLBACK' || ![ROBOT_TOPIC, ...(this.admitCard && this.config.cardTemplateId ? [CARD_TOPIC] : [])].includes(frame.headers?.topic ?? '') || !frame.headers?.messageId) return;
          const id = frame.headers.messageId;
          const ack = () => { if (!controller.signal.aborted && this.#socket === current) current.send(JSON.stringify({ code: 200,
            headers: { contentType: 'application/json', messageId: id }, message: 'OK', data: JSON.stringify({ response: null }) })); };
          const now = Date.now();
          for (const [key, time] of this.#seen) if (now - time > 300_000) this.#seen.delete(key);
          if (this.#seen.has(id)) { ack(); return; }
          if (!this.isOpen() || this.#pending.has(id) || this.#pending.size >= 100) return;
          let event: DingTalkEvent | import('./cards.js').DingTalkCardCallback;
          try { event = JSON.parse(frame.data ?? ''); } catch { return; }
          const card = frame.headers.topic === CARD_TOPIC;
          if (!event || typeof event !== 'object' || (!card && !(event as DingTalkEvent).msgtype)) return;
          this.#pending.add(id);
          void (card ? this.admitCard!(event as import('./cards.js').DingTalkCardCallback, id) : this.admit(event as DingTalkEvent)).then(() => {
            if (controller.signal.aborted) return;
            this.#seen.set(id, Date.now());
            while (this.#seen.size > 10_000) this.#seen.delete(this.#seen.keys().next().value!);
            ack();
          }).catch(() => { /* no ACK: allow server retry */ }).finally(() => this.#pending.delete(id));
        });
      });
    });
  }
  async stop(): Promise<void> { this.#active?.abort(); await this.lifecycle.stop(); this.#socket = undefined; this.#seen.clear(); }
}
