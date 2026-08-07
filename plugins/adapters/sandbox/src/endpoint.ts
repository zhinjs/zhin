/**
 * SandboxWsEndpoint — WebSocket lifecycle and MessageGateway bridge for /sandbox.
 */
import { randomUUID } from 'node:crypto';
import type { EndpointInstance, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  bindSandboxWsSocket,
  formatSandboxOutbound,
  parseSandboxWsPayload,
  sandboxInboundConversation,
  whenWsOpen,
  type ResolvedSandboxBot,
  type SandboxWsSocket,
} from './protocol.js';

const logger = getLogger('sandbox');

/**
 * 多 sandbox endpoint 共用同一个 HttpHost 时，同 path 的所有 WS listener
 * 都会被回调（入站重复、出站互窜）。按 endpoint 名隔离挂载路径：
 * 首个占用 `/sandbox`（保持 Console 默认兼容），其余退到 `/sandbox/<name>`。
 * 认领记录按 HttpHost 隔离，endpoint stop() 时必须 release。
 */
const claimedWsPaths = new WeakMap<HttpHost, Map<string, string>>();

function claimSandboxWsPath(
  http: HttpHost,
  name: string,
): { readonly path: string; readonly release: () => void } {
  let claims = claimedWsPaths.get(http);
  if (!claims) {
    claims = new Map();
    claimedWsPaths.set(http, claims);
  }
  const candidates = ['/sandbox', `/sandbox/${encodeURIComponent(name)}`];
  let path = candidates.find(
    (candidate) => !claims!.has(candidate) || claims!.get(candidate) === name,
  );
  if (!path) {
    let index = 2;
    path = `/sandbox/${encodeURIComponent(name)}-${index}`;
    while (claims.has(path)) {
      index += 1;
      path = `/sandbox/${encodeURIComponent(name)}-${index}`;
    }
  }
  claims.set(path, name);
  const claimed = path;
  const registry = claims;
  return {
    path: claimed,
    release: () => {
      if (registry.get(claimed) === name) registry.delete(claimed);
    },
  };
}

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

/**
 * Sandbox 是本地开发/测试面，无平台社交图谱（好友/群/频道），
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class SandboxWsEndpoint implements EndpointInstance {
  readonly #options: SandboxEndpointOptions;
  readonly #connections = new Map<string, SandboxConnection>();
  #wsHandleRelease?: () => void;
  #wsPathRelease?: () => void;
  #wsPath = '/sandbox';
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
    // 多 endpoint 同 path 会被全部回调（入站重复、出站互窜），按名隔离。
    const claim = claimSandboxWsPath(this.#options.http, this.#options.defaults.name);
    this.#wsPathRelease = claim.release;
    this.#wsPath = claim.path;
    const handle = this.#options.http.ws(claim.path);
    this.#wsHandleRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    if (!this.#options.defaults.randomNamePerConnection) {
      this.#ensurePlaceholder(this.#options.defaults.name, this.#options.defaults.owner);
    }
    logger.info(`ws mounted ${claim.path} | endpoint: ${this.#options.defaults.name}`);
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
    this.#wsPathRelease?.();
    this.#wsPathRelease = undefined;
    for (const connection of this.#connections.values()) {
      connection.release();
      if (!connection.placeholder) {
        try {
          connection.socket.close(1001, 'sandbox endpoint stopped');
        } catch {
          /* already closed */
        }
      }
    }
    this.#connections.clear();
    this.#started = false;
    logger.debug(formatCompact({ op: 'sandbox_stopped' }));
  }

  send({ conversation, payload }: EndpointSendRequest): unknown {
    if (!this.#open) return undefined;
    // Reply targets this endpoint's own live socket (fixed bot name, or the
    // only live random-name connection); conversation carries kind/id stamp.
    const connection = this.#connections.get(this.#options.defaults.name)
      ?? this.#findLiveConnection();
    if (!connection) {
      logger.debug(formatCompact({
        op: 'sandbox_send_miss',
        target: `${conversation.kind}:${conversation.id}`,
      }));
      return undefined;
    }
    if (connection.placeholder) {
      logger.debug(formatCompact({
        op: 'sandbox_send_placeholder',
        target: `${conversation.kind}:${conversation.id}`,
      }));
      return undefined;
    }
    // Console UI filters by type+id; stamp the conversation onto outbound wire.
    connection.socket.send(formatSandboxOutbound(payload, {
      type: conversation.kind,
      id: conversation.id,
      bot: this.#options.defaults.name,
      endpoint: connection.target,
    }));
    logger.debug(formatCompact({
      op: 'sandbox_send',
      target: connection.target,
      channelType: conversation.kind,
      channelId: conversation.id,
    }));
    return payload;
  }

  /** Prefer a real (non-placeholder) socket when reply target key is wrong/stale. */
  #findLiveConnection(): SandboxConnection | undefined {
    for (const connection of this.#connections.values()) {
      if (!connection.placeholder) return connection;
    }
    return undefined;
  }

  #acceptConnection(connection: WsConnection): void {
    const target = this.#options.defaults.randomNamePerConnection
      ? `sandbox-${randomUUID().slice(0, 8)}`
      : this.#options.defaults.name;
    const owner = this.#options.defaults.owner;
    const socket = connection.socket as SandboxWsSocket;
    // Fixed-name mode reuses `target`; dropping the prior entry without
    // closing its socket leaves a zombie browser tab that still looks
    // connected but never receives outbound traffic.
    const previous = this.#connections.get(target);
    if (previous) {
      previous.release();
      if (!previous.placeholder) {
        try {
          previous.socket.close(4000, 'replaced by new sandbox client');
        } catch {
          /* already closed */
        }
      }
      this.#connections.delete(target);
    }
    const release = bindSandboxWsSocket(socket, {
      onMessage: (raw) => {
        const parsed = parseSandboxWsPayload(raw);
        const sender = parsed.id || owner;
        const conversation = sandboxInboundConversation(String(this.#options.id), {
          type: parsed.type,
          id: sender,
        });
        logger.debug(formatCompact({
          op: 'sandbox_recv',
          target,
          sender,
          channelType: parsed.type,
          channelId: sender,
          text: parsed.text.slice(0, 80),
        }));
        // Don't gate on #open — inbound must always reach the gateway so
        // Command/AI dispatch and outbound replies work.
        void this.#options.gateway.receive({
          conversation,
          content: parsed.text,
          sender,
          metadata: Object.freeze({
            type: parsed.type,
            channelType: parsed.type,
            channelId: parsed.id || owner,
            endpoint: target,
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
        // Only drop the map entry if we still own this socket — a replace
        // may have already swapped in a newer connection for the same target.
        const current = this.#connections.get(target);
        if (current && current.socket === socket) {
          this.#connections.delete(target);
          logger.debug(formatCompact({ op: 'sandbox_ws_closed', target }));
        }
      },
      onError: (err) => {
        logger.warn(formatCompact({
          op: 'sandbox_ws_error',
          target,
          error: err instanceof Error ? err.message : String(err),
        }));
      },
    });
    this.#connections.set(target, { target, owner, socket, release });
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
              `与 Node Host 控制台沙盒协议一致（${this.#wsPath}）`,
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
    this.#connections.set(name, {
      target: name,
      owner,
      socket: { send: () => undefined, close: () => undefined },
      release: () => undefined,
      placeholder: true,
    });
  }
}
