import { Endpoint } from 'zhin.js/adapter';
/**
 * SandboxWsEndpoint — WebSocket lifecycle and OutboundMessageService bridge for /sandbox.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { type EndpointSendRequest } from 'zhin.js/adapter';
import type { HttpHost, WsConnection } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  bindSandboxWsSocket,
  formatSandboxOutbound,
  parseSandboxWsPayload,
  sandboxInboundConversation,
  whenWsOpen,
  type ResolvedSandboxBot,
  type SandboxWsSocket,
} from './protocol.js';
import { SandboxClient, type SandboxClientConnection } from './client.js';

/**
 * 多 sandbox endpoint 共用同一个 HttpHost 时，同 path 的所有 WS listener
 * 都会被回调（入站重复、出站互窜）。按 endpoint 名隔离挂载路径：
 * 首个占用 `/sandbox`（保持 Console 默认兼容），其余退到 `/sandbox/<name>`。
 * 认领记录按 HttpHost 隔离，endpoint stop() 时必须 release。
 */
interface SandboxWsPathClaim {
  readonly name: string;
  readonly owners: Set<symbol>;
}

const claimedWsPaths = new WeakMap<HttpHost, Map<string, SandboxWsPathClaim>>();

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
    (candidate) => !claims!.has(candidate) || claims!.get(candidate)?.name === name,
  );
  if (!path) {
    let index = 2;
    path = `/sandbox/${encodeURIComponent(name)}-${index}`;
    while (claims.has(path)) {
      index += 1;
      path = `/sandbox/${encodeURIComponent(name)}-${index}`;
    }
  }
  const owner = Symbol(name);
  const claim = claims.get(path) ?? { name, owners: new Set<symbol>() };
  claim.owners.add(owner);
  claims.set(path, claim);
  const claimed = path;
  const registry = claims;
  return {
    path: claimed,
    release: () => {
      claim.owners.delete(owner);
      if (claim.owners.size === 0 && registry.get(claimed) === claim) {
        registry.delete(claimed);
      }
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

type ShellIsolationStatus = Readonly<{
  available: boolean;
  provider: 'docker';
  message: string;
}>;

type ShellIsolationProbe = () => Promise<ShellIsolationStatus>;

/**
 * Share an in-flight readiness probe across reconnects while still allowing a
 * later connection to refresh the informational status after it settles.
 * Kept internal to this module's package surface; tests import it directly.
 */
export function createSandboxReadinessGate(probe: ShellIsolationProbe): Readonly<{
  afterProbe: (deliver: (status: ShellIsolationStatus) => void) => void;
}> {
  let inFlight: Promise<ShellIsolationStatus> | undefined;
  const acquire = (): Promise<ShellIsolationStatus> => {
    if (inFlight) return inFlight;
    const pending = probe();
    const shared = pending.finally(() => {
      if (inFlight === shared) inFlight = undefined;
    });
    inFlight = shared;
    return shared;
  };
  return Object.freeze({
    afterProbe: (deliver) => {
      void acquire().then(deliver);
    },
  });
}

export interface SandboxEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly defaults: ResolvedSandboxBot;
}

/**
 * Sandbox 是本地开发/测试面，无平台社交图谱（好友/群/频道），
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class SandboxWsEndpoint extends Endpoint<SandboxClient> {
  readonly client: SandboxClient;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SandboxEndpointOptions;
  readonly #connections = new Map<string, SandboxConnection>();
  readonly #readiness = createSandboxReadinessGate(probeShellIsolation);
  #wsHandleRelease?: () => void;
  #wsPathRelease?: () => void;
  #wsPath = '/sandbox';
  #open = false;
  #started = false;

  constructor(options: SandboxEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('sandbox', options.defaults.id);
    this.#options = options;
    this.client = new SandboxClient(
      () => this.#wsPath,
      () => [...this.#connections.values()].map((connection) => ({
        target: connection.target,
        owner: connection.owner,
        socket: connection.socket,
        placeholder: connection.placeholder === true,
      } satisfies SandboxClientConnection)),
    );
  }

  /** Live endpoint id (config `id`) — Console endpoint.list/resolve uses it. */
  get name(): string {
    return this.#options.defaults.id;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    // 多 endpoint 同 path 会被全部回调（入站重复、出站互窜），按名隔离。
    const claim = claimSandboxWsPath(this.#options.http, this.#options.defaults.id);
    this.#wsPathRelease = claim.release;
    this.#wsPath = claim.path;
    const handle = this.#options.http.ws(claim.path);
    this.#wsHandleRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    if (!this.#options.defaults.randomNamePerConnection) {
      this.#ensurePlaceholder(this.#options.defaults.id, this.#options.defaults.owner);
    }
    this.#logger.info(`ws mounted ${claim.path}`);
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
    this.#logger.debug(formatCompact({ op: 'sandbox_stopped' }));
  }

  send({ conversation, payload }: EndpointSendRequest): string {
    if (!this.#open) throw new Error('Sandbox Endpoint is not open');
    // Reply targets this endpoint's own live socket (fixed bot name, or the
    // only live random-name connection); conversation carries kind/id stamp.
    const connection = this.#connections.get(this.#options.defaults.id)
      ?? this.#findLiveConnection();
    if (!connection) {
      this.#logger.debug(formatCompact({
        op: 'sandbox_send_miss',
        target: `${conversation.kind}:${conversation.id}`,
      }));
      throw new Error('Sandbox Endpoint has no live connection');
    }
    if (connection.placeholder) {
      this.#logger.debug(formatCompact({
        op: 'sandbox_send_placeholder',
        target: `${conversation.kind}:${conversation.id}`,
      }));
      throw new Error('Sandbox Endpoint has no live connection');
    }
    // Console UI filters by type+id; stamp the conversation onto outbound wire.
    connection.socket.send(formatSandboxOutbound(payload, {
      type: conversation.kind,
      id: conversation.id,
      bot: this.#options.defaults.id,
      endpoint: connection.target,
    }));
    this.#logger.debug(formatCompact({
      op: 'sandbox_send',
      target: connection.target,
      channelType: conversation.kind,
      channelId: conversation.id,
    }));
    return randomUUID();
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
      : this.#options.defaults.id;
    const owner = this.#options.defaults.owner;
    const canExecute = connection.authScope === 'full';
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
        void this.#emitPlatformEvent('message', raw);
        if (!canExecute) {
          socket.send(JSON.stringify({
            type: 'error',
            id: owner,
            endpoint: target,
            content: [{ type: 'text', data: { text: '当前连接是只读演示权限，不能运行 Agent 任务。' } }],
            timestamp: Date.now(),
          }));
          return;
        }
        const parsed = parseSandboxWsPayload(raw);
        const sceneId = parsed.id || owner;
        const conversation = sandboxInboundConversation(String(this.#options.id), {
          type: parsed.type,
          id: sceneId,
        });
        this.#logger.debug(formatCompact({
          op: 'sandbox_recv',
          target,
          sender: owner,
          channelType: parsed.type,
          channelId: sceneId,
          text: parsed.text.slice(0, 80),
        }));
        // Don't gate on #open — inbound must always reach the gateway so
        // Command/AI dispatch and outbound replies work.
        void this.emit('message.receive', {
          conversation,
          ...(parsed.messageId ? { message: { conversation, id: parsed.messageId } } : {}),
          content: parsed.text,
          sender: { id: owner },
          endpointId: target,
          metadata: Object.freeze({
            type: parsed.type,
            channelType: parsed.type,
            channelId: parsed.id || owner,
            elements: parsed.content,
            timestamp: parsed.timestamp,
            ...(parsed.action ? { action: parsed.action } : {}),
            ...(parsed.agentRun ? { sandboxAgentRun: parsed.agentRun } : {}),
          }),
        }).catch((err) => {
          this.#logger.warn(formatCompact({
            op: 'sandbox_gateway_receive_failed',
            target,
            error: err instanceof Error ? err.message : String(err),
          }));
        });
      },
      onClose: () => {
        void this.#emitPlatformEvent('connection.close', { target, owner });
        // Only drop the map entry if we still own this socket — a replace
        // may have already swapped in a newer connection for the same target.
        const current = this.#connections.get(target);
        if (current && current.socket === socket) {
          this.#connections.delete(target);
          this.#logger.debug(formatCompact({ op: 'sandbox_ws_closed', target }));
        }
      },
      onError: (err) => {
        void this.#emitPlatformEvent('connection.error', { target, owner, error: err });
        this.#logger.warn(formatCompact({
          op: 'sandbox_ws_error',
          target,
          error: err instanceof Error ? err.message : String(err),
        }));
      },
    });
    this.#connections.set(target, { target, owner, socket, release });
    void this.#emitPlatformEvent('connection.open', { target, owner, socket });
    this.#logger.debug(formatCompact({ op: 'sandbox_ws_connected', target, owner }));
    this.#readiness.afterProbe((shellIsolation) => {
      const current = this.#connections.get(target);
      if (!current || current.socket !== socket) return;
      const readyPayload = JSON.stringify({
        type: 'ready',
        id: owner,
        endpoint: target,
        workingDirectory: process.cwd(),
        canExecute,
        shellIsolation,
        content: [{
          type: 'text',
          data: {
            text: [
              `已连接 Sandbox「${target}」`,
              `与 Node Host 控制台沙盒协议一致（${this.#wsPath}）`,
              'Agent 试验台会话已启用持久化运行配置。',
            ].join('\n'),
          },
        }],
        timestamp: Date.now(),
      });
      whenWsOpen(socket, () => socket.send(readyPayload));
    });
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

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'sandbox_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

function probeShellIsolation(): Promise<ShellIsolationStatus> {
  return new Promise<ShellIsolationStatus>((resolve) => {
    execFile('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8',
      timeout: 500,
    }, (error, stdout) => {
      if (!error) {
        const version = stdout.trim();
        resolve(Object.freeze({
          available: true,
          provider: 'docker',
          message: version ? `Docker ${version}` : 'Docker ready',
        }));
        return;
      }
      resolve(Object.freeze({
        available: false,
        provider: 'docker',
        message: error.killed || error.code === 'ETIMEDOUT'
          ? 'Docker readiness check timed out'
          : 'Docker daemon is unavailable',
      }));
    });
  }).catch(() => Object.freeze({
    available: false,
    provider: 'docker' as const,
    message: 'Docker is unavailable',
  }));
}
