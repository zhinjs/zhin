/**
 * SandboxWsEndpoint — WebSocket lifecycle and MessageGateway bridge for /sandbox.
 */
import { randomUUID } from 'node:crypto';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  bindSandboxWsSocket,
  formatSandboxOutbound,
  parseSandboxWsPayload,
  whenWsOpen,
  type ResolvedSandboxBot,
  type SandboxWsSocket,
} from './protocol.js';

const logger = getLogger('sandbox');

interface SandboxConnection {
  readonly target: string;
  readonly owner: string;
  readonly socket: SandboxWsSocket;
  readonly release: () => void;
  /** true = 占位连接（尚无真实 WS 客户端），send 命中时按 miss 处理。 */
  readonly placeholder?: boolean;
}

export interface SandboxEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http: HttpHost;
  readonly defaults: ResolvedSandboxBot;
}

export class SandboxWsEndpoint implements EndpointInstance {
  readonly #options: SandboxEndpointOptions;
  readonly #connections = new Map<string, SandboxConnection>();
  #wsHandleRelease?: () => void;
  #open = false;
  #started = false;

  constructor(options: SandboxEndpointOptions) {
    this.#options = options;
  }

  /** Live endpoint name (config `name`) — Console endpoint.list/resolve uses it. */
  get name(): string {
    return this.#options.defaults.name;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    const handle = this.#options.http.ws('/sandbox');
    this.#wsHandleRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    if (!this.#options.defaults.randomNamePerConnection) {
      this.#ensurePlaceholder(this.#options.defaults.name, this.#options.defaults.owner);
    }
    logger.info(formatCompact({
      op: 'sandbox_ws_mounted',
      path: '/sandbox',
      endpoint: this.#options.defaults.name,
    }));
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  stop(): void {
    this.#open = false;
    this.#wsHandleRelease?.();
    this.#wsHandleRelease = undefined;
    for (const connection of this.#connections.values()) connection.release();
    this.#connections.clear();
    this.#started = false;
    logger.debug(formatCompact({ op: 'sandbox_stopped' }));
  }

  send({ target, payload }: { readonly target: string; readonly payload: unknown }): unknown {
    if (!this.#open) return undefined;
    const connection = this.#connections.get(target);
    if (!connection) {
      logger.debug(formatCompact({ op: 'sandbox_send_miss', target }));
      return undefined;
    }
    if (connection.placeholder) {
      logger.debug(formatCompact({ op: 'sandbox_send_placeholder', target }));
      return undefined;
    }
    connection.socket.send(formatSandboxOutbound(payload));
    logger.debug(formatCompact({ op: 'sandbox_send', target }));
    return payload;
  }

  #acceptConnection(connection: WsConnection): void {
    const target = this.#options.defaults.randomNamePerConnection
      ? `sandbox-${randomUUID().slice(0, 8)}`
      : this.#options.defaults.name;
    const owner = this.#options.defaults.owner;
    const socket = connection.socket as SandboxWsSocket;
    if (this.#connections.has(target)) {
      this.#connections.get(target)?.release();
      this.#connections.delete(target);
    }
    const release = bindSandboxWsSocket(socket, {
      onMessage: (raw) => {
        if (!this.#open) return;
        const parsed = parseSandboxWsPayload(raw);
        logger.debug(formatCompact({
          op: 'sandbox_recv',
          target,
          sender: parsed.id || owner,
          text: parsed.text.slice(0, 80),
        }));
        void this.#options.gateway.receive({
          adapter: this.#options.id,
          target,
          content: parsed.text,
          sender: parsed.id || owner,
          metadata: Object.freeze({
            type: parsed.type,
            elements: parsed.content,
            timestamp: parsed.timestamp,
            ...(parsed.action ? { action: parsed.action } : {}),
          }),
        }).catch((err) => {
          logger.warn(formatCompact({
            op: 'sandbox_gateway_receive_failed',
            target,
            error: err instanceof Error ? err.message : String(err),
          }));
        });
      },
      onClose: () => {
        this.#connections.delete(target);
        logger.debug(formatCompact({ op: 'sandbox_ws_closed', target }));
      },
      onError: (err) => {
        logger.warn(formatCompact({
          op: 'sandbox_ws_error',
          target,
          error: err instanceof Error ? err.message : String(err),
        }));
      },
    });
    this.#connections.set(target, Object.freeze({ target, owner, socket, release }));
    logger.debug(formatCompact({ op: 'sandbox_ws_connected', target, owner }));
    if (!this.#options.defaults.randomNamePerConnection) {
      const readyPayload = JSON.stringify({
        type: 'ready',
        id: owner,
        endpoint: target,
        content: [{
          type: 'text',
          data: {
            text: [
              `已连接 Sandbox「${target}」`,
              '与 Node Host 控制台沙盒协议一致（/sandbox）',
              '命令: help · ping · zt · status',
            ].join('\n'),
          },
        }],
        timestamp: Date.now(),
      });
      whenWsOpen(socket, () => socket.send(readyPayload));
    }
  }

  #ensurePlaceholder(name: string, owner: string): void {
    if (this.#connections.has(name)) return;
    this.#connections.set(name, Object.freeze({
      target: name,
      owner,
      socket: { send: () => undefined, close: () => undefined },
      release: () => undefined,
      placeholder: true,
    }));
  }
}
