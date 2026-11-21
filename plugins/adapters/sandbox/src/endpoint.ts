import { createMessages, resolveLocale, type Locale } from 'zhin.js/i18n';
import { createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification, type EndpointSendRequest,
  type EndpointStreaming, type EndpointStreamRequest, type EndpointMessageStream, type EndpointStreamAcknowledgement,
  type EndpointControl, type AdapterConsoleSpeakerPort } from 'zhin.js/adapter';
/**
 * SandboxWsEndpoint — WebSocket lifecycle and OutboundMessageService bridge for /sandbox.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { principalAllows, type HttpHost, type WsConnection } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import { hostChatRole, isMediaRef, toCanonicalSegments, type CapabilityId, type ChatRoleReader, type MessageElement } from 'zhin.js';
import { EndpointDeliveryError, type MessageRef, type PlatformStandingLevel } from '@zhin.js/im-contract';
import {
  bindSandboxWsSocket,
  sandboxSocketOf,
  formatSandboxOutbound,
  parseSandboxWsFrame,
  sandboxInboundConversation,
  sandboxSimulatedSenderId,
  whenWsOpen,
  type ResolvedSandboxBot,
  type SandboxWsSocket,
  type SandboxConversation,
} from './protocol.js';
import { SandboxClient } from './client.js';
import { join } from 'node:path';
import { SandboxMediaStore } from './media-store.js';
import { mountSandboxMediaRoutes, sandboxMediaActor } from './media-routes.js';
import { SANDBOX_MEDIA_PUBLIC_PREFIX, isSandboxMediaPath } from './media-url.js';

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
  readonly connectionId: string;
  readonly target: string;
  readonly owner: string;
  readonly socket: SandboxWsSocket;
  readonly release: () => void;
  readonly canExecute: boolean;
  conversation: SandboxConversation;
  scoped: boolean;
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

const messages = createMessages({
  readOnly: { 'zh-CN': '当前连接是只读演示权限，不能运行 Agent 任务。', en: 'This connection is a read-only demo and cannot run Agent tasks.' },
  connected: { 'zh-CN': '已连接 Sandbox「{target}」', en: 'Connected to Sandbox “{target}”' },
  protocol: { 'zh-CN': '与 Node Host 控制台沙盒协议一致（{path}）', en: 'Using the Node Host Console sandbox protocol ({path})' },
  profile: { 'zh-CN': '会话已启用持久化运行配置。', en: 'The conversation uses a persistent runtime profile.' },
  invalidFrame: { 'zh-CN': '会话订阅或消息格式无效。', en: 'The conversation subscription or message format is invalid.' },
  receiveFailed: { 'zh-CN': '机器人没能处理这条输入：{error}', en: 'The bot could not process this input: {error}' },
  asMeTimeout: { 'zh-CN': '建立 Sandbox 身份超时（{seconds} 秒）', en: 'Creating the Sandbox identity timed out ({seconds} s)' },
  mediaRejected: { 'zh-CN': '消息里的文件不属于这个会话、已过期、签名无效，或指向本机路径，没有发送。', en: 'A file in this message belongs to another conversation, has expired, has an invalid signature or names a path on the host; the message was not sent.' },
});

/** How often expired uploads are swept (also once at start). */
const MEDIA_SWEEP_INTERVAL_MS = 3_600_000;

/**
 * Every address-like string a segment carries, nested segments (forward records) included, but not
 * its text: a hosted link typed as plain words is not a media reference.
 */
function segmentStrings(segment: unknown, depth = 0): string[] {
  // Fail closed: content nested deeper than any real segment counts as an unverifiable hosted link.
  if (depth > 16) return [SANDBOX_MEDIA_PUBLIC_PREFIX];
  if (!segment || typeof segment !== 'object') return [];
  if (Array.isArray(segment)) return segment.flatMap(item => segmentStrings(item, depth + 1));
  return Object.entries(segment as Record<string, unknown>).flatMap(([key, value]) => {
    if (key === 'text') return [];
    if (typeof value === 'string') return [value];
    return segmentStrings(value, depth + 1);
  });
}

const INBOUND_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'file', 'record', 'voice']);

/**
 * Whether a segment tree names a file on this host (`media.kind: 'path'`, or a legacy `path` /
 * `file_path` / `/…` field that Core's ingress mapper turns into one). A browser never has a reason
 * to send a host path, and the Agent's inbound media reads such a ref straight from disk without
 * the file policy — it would read `.zhin/sandbox/media/*` (any conversation's uploads, and the
 * signing key) or any other file. Nested deeper than any real segment counts as a path (fail closed).
 */
function carriesLocalMediaPath(value: unknown, depth = 0): boolean {
  if (depth > 16) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => carriesLocalMediaPath(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (record.kind === 'path' && typeof record.value === 'string') return true;
  if (typeof record.type === 'string' && INBOUND_MEDIA_TYPES.has(record.type.toLowerCase()) && record.data && typeof record.data === 'object') {
    const type = ['record', 'voice'].includes(record.type.toLowerCase()) ? 'audio' : record.type.toLowerCase();
    const [canonical] = toCanonicalSegments([{ type, data: record.data } as MessageElement]);
    const media = (canonical?.data as Record<string, unknown> | undefined)?.media;
    if (isMediaRef(media) && media.kind === 'path') return true;
    // Core no longer guesses a path from `data.file` (#1250); the Sandbox issues no such tokens,
    // so a path-shaped one (`/etc/passwd`, `./.zhin/…`, `~/…`, `C:\…`) is still refused here.
    if (isMediaRef(media) && media.kind === 'file' && /^(?:[/\\.~]|[a-z]:)/iu.test(media.value)) return true;
  }
  return Object.values(record).some(item => carriesLocalMediaPath(item, depth + 1));
}

export interface SandboxEndpointOptions {
  /** Project language captured from this endpoint generation's resources. */
  readonly locale?: Locale;
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly defaults: ResolvedSandboxBot;
  /** Chat roles (`chatRolesToken`, ADR 0060 §6): the sender's zhin role shown on the page. */
  readonly chatRoles?: ChatRoleReader;
  /**
   * ADR 0060 §5.4 (#1250 sandbox-speak-as-me): creates the signed-in Console user's
   * `console-<userId>` identity (`AdapterContext.consoleSpeaker`, given only to trusted local
   * simulation Adapters — this package's). It takes the socket's own `connection.principal` object:
   * the Root accepts only principals its HTTP Host issued, never a copy or a built object.
   * Absent: 「以我的聊天身份发言」 needs an identity created in the Console first.
   */
  readonly consoleSpeaker?: AdapterConsoleSpeakerPort;
  /** How long a message waits for {@link consoleSpeaker} (default {@link SANDBOX_CONSOLE_SPEAKER_TIMEOUT_MS}). */
  readonly consoleSpeakerTimeoutMs?: number;
  /** Hosted upload root; default `<cwd>/.zhin/sandbox/media` (ADR 0064 D12.1). */
  readonly mediaRoot?: string;
}

/**
 * ADR 0060 §5.4 (P0): what the Runtime resolves for this sender — zhin role and the Agent trust
 * tier it implies (`resolveTurnTrustLevel`: a global owner → `owner`, admin / trusted or a
 * lower-level owner → `trusted_member`, anyone else over IM → `group_member`). The page shows it
 * next to the simulated platform standing so 群主 is never mistaken for a zhin role.
 */
export function sandboxSenderRoleFacts(reader: ChatRoleReader | undefined, conversation: Parameters<ChatRoleReader['factsOf']>[0], senderId: string):
  { senderChatRole?: string; senderTrustLevel: 'owner' | 'trusted_member' | 'group_member' } {
  let facts: ReturnType<ChatRoleReader['factsOf']>;
  try { facts = reader?.factsOf(conversation, senderId); } catch { facts = undefined; }
  const host = hostChatRole(facts);
  return {
    ...(facts?.chatRole ? { senderChatRole: facts.chatRole } : {}),
    senderTrustLevel: host === 'owner' ? 'owner' : host ? 'trusted_member' : 'group_member',
  };
}

/**
 * Why 「以我的聊天身份发言」 was not used for a message (`asMeUnavailable` on the echo).
 * `needs-self-chat-identity`: the Console user lacks `self.chat-identity` (what
 * `chat-identities.simulated.ensure` requires); `identity-failed`: creating the identity failed or
 * timed out (`asMeError` says why).
 */
export type SandboxAsMeUnavailableReason = 'no-console-user' | 'no-identity' | 'needs-global-iam' | 'needs-self-chat-identity' | 'identity-failed';

/** How long the first 「以我的聊天身份发言」 message waits for its identity before it goes out simulated. */
export const SANDBOX_CONSOLE_SPEAKER_TIMEOUT_MS = 10_000;

interface SandboxConsoleUser {
  readonly userId: string;
  readonly displayName?: string;
  /** Holds global `iam.manage`: may speak as a linked person who holds a global grant (ADR 0060 §5.4). */
  readonly canManageGlobal: boolean;
  /** Holds `self.chat-identity`: may speak as (and create) their own chat identity (#1250). */
  readonly canUseChatIdentity: boolean;
}

/** The signed-in Console user behind a socket (sessions and API tokens); none for the bootstrap principal or standalone. */
export function sandboxConsoleUser(principal: WsConnection['principal']): SandboxConsoleUser | undefined {
  if (!principal || (principal.kind !== 'user' && principal.kind !== 'api-token')) return undefined;
  if (typeof principal.userId !== 'string' || !principal.userId) return undefined;
  const allows = (permission: string) => { try { return principalAllows(principal, permission); } catch { return false; } };
  return Object.freeze({ userId: principal.userId, ...(principal.displayName ? { displayName: principal.displayName } : {}),
    canManageGlobal: allows('iam.manage'), canUseChatIdentity: allows('self.chat-identity') });
}

/**
 * Sandbox 是本地开发/测试面，无平台社交图谱（好友/群/频道），
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class SandboxWsEndpoint extends SandboxClient<SandboxConnection> implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SandboxEndpointOptions;
  readonly #locale: Locale;
  readonly #readiness = createSandboxReadinessGate(probeShellIsolation);
  #wsHandleRelease?: () => void;
  #wsPathRelease?: () => void;
  readonly #media: SandboxMediaStore;
  #mediaRoutesRelease?: () => void;
  #mediaSweep?: ReturnType<typeof setInterval>;
  #open = false;
  #started = false;

  constructor(options: SandboxEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('sandbox', options.defaults.id);
    this.#options = options;
    this.#locale = resolveLocale(options.locale);
    // Lazy on disk: nothing is created until the first upload.
    this.#media = new SandboxMediaStore({ root: options.mediaRoot ?? join(process.cwd(), '.zhin', 'sandbox', 'media'),
      endpointId: options.defaults.id, config: options.defaults.media });
    const readTransportState = () => this.#transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      name: options.defaults.id,
      start: () => this.#start(), open: () => this.#openEndpoint(),
      close: () => this.#close(), stop: () => this.#stop(),
      send: request => this.#send(request),
      control: this.#control(),
      ...(options.defaults.streaming ? { streaming: Object.freeze<EndpointStreaming>({ mode: 'native',
        minIntervalMs: options.defaults.streamingIntervalMs, supports: request => this.#supportsStream(request),
        open: request => this.#openStream(request) }) } : {}),
      get transportState() { return readTransportState(); },
    });
  }

  /** The Sandbox transport is the mounted local listener, not a remote account. */
  get #transportState(): 'open' | 'idle' {
    return this.#started && this.#wsHandleRelease ? 'open' : 'idle';
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    // 多 endpoint 同 path 会被全部回调（入站重复、出站互窜），按名隔离。
    const claim = claimSandboxWsPath(this.#options.http, this.#options.defaults.id);
    this.#wsPathRelease = claim.release;
    this.wsPathValue = claim.path;
    const handle = this.#options.http.ws(claim.path);
    this.#wsHandleRelease = handle.onConnection((connection) => {
      this.#acceptConnection(connection);
    });
    if (!this.#options.defaults.randomNamePerConnection) {
      this.#ensurePlaceholder(this.#options.defaults.id, this.#options.defaults.owner);
    }
    this.#mediaRoutesRelease = mountSandboxMediaRoutes({ http: this.#options.http, store: this.#media, logger: this.#logger });
    this.#sweepMedia();
    this.#mediaSweep = setInterval(() => this.#sweepMedia(), MEDIA_SWEEP_INTERVAL_MS);
    this.#mediaSweep.unref?.();
    this.#logger.info(`ws mounted ${claim.path}`);
  }

  #openEndpoint(): void {
    this.#open = true;
    // Synthetic account: Sandbox has no platform login, so its Bot identity is the
    // configured bot id. Per-connection random names are not Bot accounts.
    this[endpointSpec].reportSelfUserId(this.#options.defaults.id);
  }

  #close(): void {
    this.#open = false;
  }

  #stop(): void {
    this.#open = false;
    this[endpointSpec].reportSelfUserId(undefined);
    this.#wsHandleRelease?.();
    this.#wsHandleRelease = undefined;
    this.#wsPathRelease?.();
    this.#wsPathRelease = undefined;
    this.#mediaRoutesRelease?.();
    this.#mediaRoutesRelease = undefined;
    if (this.#mediaSweep) clearInterval(this.#mediaSweep);
    this.#mediaSweep = undefined;
    for (const connection of this.connectionRecords.values()) {
      connection.release();
      if (!connection.placeholder) {
        try {
          connection.socket.close(1001, 'sandbox endpoint stopped');
        } catch {
          /* already closed */
        }
      }
    }
    this.connectionRecords.clear();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'sandbox_stopped' }));
  }

  #send({ conversation, payload }: EndpointSendRequest): string {
    if (!this.#open) throw new Error('Sandbox Endpoint is not open');
    const scene = { type: conversation.kind, id: conversation.id };
    const subscribers = this.#subscribers(scene);
    if (!subscribers.length) {
      throw new EndpointDeliveryError('sandbox_delivery_unavailable', 'Sandbox Endpoint has no live connection', 'not_sent');
    }
    // Use the same identity for live messages and the canonical delivery receipt.
    const explicitMessageId = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { readonly messageId?: unknown }).messageId
      : undefined;
    const messageId = typeof explicitMessageId === 'string' && explicitMessageId.trim()
      ? explicitMessageId
      : randomUUID();
    const wire = formatSandboxOutbound(payload, {
      ...scene,
      bot: this.#options.defaults.id,
      endpoint: this.#options.defaults.id,
      messageId,
      conversation: scene,
    });
    if (this.#broadcast(subscribers, wire) === 0) {
      throw new EndpointDeliveryError(
        'sandbox_delivery_unavailable',
        'Sandbox Endpoint has no live connection',
        'unknown',
      );
    }
    return messageId;
  }

  /**
   * ADR 0064 P1b (D9): the Sandbox shows every non-segment capability too. Each operation is one
   * wire frame on the message's scene (`recall` / `edit` / `reaction`); the page applies it to the
   * message with that id. No live page = not performed, exactly like a send.
   */
  #control(): EndpointControl {
    const deliver = (message: MessageRef, frame: Record<string, unknown>): void => {
      if (!this.#open) throw new EndpointDeliveryError('endpoint_inactive', 'Sandbox Endpoint is not open', 'not_sent');
      const scene = { type: message.conversation.kind, id: message.conversation.id };
      const wire = JSON.stringify({ ...frame, id: scene.id, conversation: scene, endpoint: this.#options.defaults.id,
        bot: this.#options.defaults.id, messageId: message.id, timestamp: Date.now() });
      if (this.#broadcast(this.#subscribers(scene), wire) === 0) {
        throw new EndpointDeliveryError('sandbox_delivery_unavailable', 'Sandbox Endpoint has no live connection', 'not_sent');
      }
    };
    return Object.freeze<EndpointControl>({
      recall: async ({ message, signal }) => {
        signal?.throwIfAborted();
        deliver(message, { type: 'recall' });
      },
      edit: async ({ message, content, signal }) => {
        signal?.throwIfAborted();
        const wire = JSON.parse(formatSandboxOutbound(content, { messageId: message.id })) as { content?: unknown };
        deliver(message, { type: 'edit', content: wire.content ?? [] });
        return message.id;
      },
      addReaction: async ({ message, emoji, signal }) => {
        signal?.throwIfAborted();
        if (typeof emoji !== 'string' || !emoji) {
          throw new EndpointDeliveryError('invalid_payload', 'Sandbox reaction needs an emoji', 'not_sent');
        }
        const reactionId = randomUUID();
        deliver(message, { type: 'reaction', op: 'add', emoji, reactionId });
        return reactionId;
      },
      removeReaction: async ({ message, reactionId, signal }) => {
        signal?.throwIfAborted();
        deliver(message, { type: 'reaction', op: 'remove', reactionId });
      },
    });
  }

  #supportsStream(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean {
    return !request.conversation.parent && request.conversation.threadId === undefined
      && ['private', 'group', 'channel'].includes(request.conversation.kind);
  }

  #openStream(request: EndpointStreamRequest): EndpointMessageStream | undefined {
    if (!this.#supportsStream(request)) return undefined;
    const messageId = randomUUID();
    let revision = 0, timestamp: number | undefined, acceptedText = '';
    let state: 'active' | 'completed' | 'cancelled' = 'active';
    let last: EndpointStreamAcknowledgement | undefined;
    const submit = async (text: string, finish: boolean): Promise<EndpointStreamAcknowledgement> => {
      if (state === 'completed') {
        if (finish && text === acceptedText) return last!;
        throw new EndpointDeliveryError('stream_closed', 'Sandbox reply stream has completed', 'not_sent');
      }
      if (state === 'cancelled' || request.signal?.aborted || !this.#open) {
        throw new EndpointDeliveryError('endpoint_inactive', 'Sandbox reply stream has ended', 'not_sent');
      }
      if (!text.startsWith(acceptedText)) throw new EndpointDeliveryError('invalid_payload', 'Sandbox stream text must preserve the confirmed prefix', 'not_sent');
      const sentAt = timestamp ?? Date.now();
      this.#send({ conversation: request.conversation, signal: request.signal, payload: {
        messageId, revision: revision + 1, streaming: !finish, timestamp: sentAt,
        content: [...(request.prefix ?? []), request.format === 'markdown'
          ? { type: 'markdown', data: { content: text } } : { type: 'text', data: { text } }],
      } });
      timestamp = sentAt; revision += 1; acceptedText = text;
      last = { status: 'sent', messageId, acceptedText };
      if (finish) state = 'completed';
      return last;
    };
    return Object.freeze<EndpointMessageStream>({ write: text => submit(text, false), finish: text => submit(text, true),
      cancel: () => { if (state === 'active') state = 'cancelled'; },
    });
  }

  #subscribers(scene: { readonly type: string; readonly id: string }, echo = false): SandboxConnection[] {
    return [...this.connectionRecords.values()].filter(connection => !connection.placeholder && connection.canExecute
      && (!echo || connection.scoped)
      && connection.conversation.type === scene.type && connection.conversation.id === scene.id
      && (connection.socket.readyState === undefined || connection.socket.readyState === 1));
  }

  /** A failing page must not prevent delivery to another subscriber or admit another turn. */
  #broadcast(subscribers: readonly SandboxConnection[], wire: string): number {
    let delivered = 0;
    for (const connection of subscribers) {
      try {
        connection.socket.send(wire);
        delivered += 1;
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'sandbox_send_failed', connectionId: connection.connectionId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return delivered;
  }

  #acceptConnection(connection: WsConnection): void {
    const target = this.#options.defaults.randomNamePerConnection
      ? `sandbox-${randomUUID().slice(0, 8)}`
      : this.#options.defaults.id;
    const owner = this.#options.defaults.owner;
    // Every admitted host-authenticated socket carries a Console principal allowed to use it.
    const canExecute = true;
    // ADR 0060 §5.4: a signed-in Console user may speak as their linked chat identity. The bootstrap
    // principal and `--standalone` (no gateway) have no user: everything is simulated there.
    const consoleUser = sandboxConsoleUser(connection.principal);
    const socket = sandboxSocketOf(connection);
    const connectionId = randomUUID();
    const subscription: SandboxConnection = {
      connectionId, target, owner, socket, canExecute, scoped: false,
      conversation: { type: 'private', id: owner },
      release: () => release(),
    };
    const placeholder = this.connectionRecords.get(this.#options.defaults.id);
    if (placeholder?.placeholder) this.connectionRecords.delete(this.#options.defaults.id);
    // #1250 sandbox-speak-as-me: the first 「以我的聊天身份发言」 message may wait for its identity to be
    // created; later frames of this socket wait their turn so messages keep their order.
    // Once the socket closed (also on `principal-revoked`, which closes it), frames still queued are dropped.
    let inbox: Promise<unknown> = Promise.resolve();
    let closed = false;
    const release = bindSandboxWsSocket(socket, {
      onMessage: (raw) => {
        inbox = inbox.then(() => closed ? undefined : this[endpointSpec].events.run(async () => {
          if (closed) return;
          if (!canExecute) {
            socket.send(JSON.stringify({
              type: 'error',
              id: owner,
              endpoint: target,
              content: [{ type: 'text', data: { text: messages(this.#locale, 'readOnly') } }],
              timestamp: Date.now(),
            }));
            return;
          }
          const frame = parseSandboxWsFrame(raw, {
            id: this.#options.defaults.id,
            ...(this.#options.defaults.nickname ? { names: [this.#options.defaults.nickname] } : {}),
          });
          if (frame.kind === 'invalid') {
            socket.send(JSON.stringify({
              type: 'error', endpoint: target, connectionId,
              content: [{ type: 'text', data: { text: messages(this.#locale, 'invalidFrame') } }],
              timestamp: Date.now(),
            }));
            return;
          }
          if (frame.kind === 'subscribe') {
            subscription.conversation = frame.conversation;
            subscription.scoped = true;
            socket.send(JSON.stringify({
              type: 'subscribed', id: frame.conversation.id, conversation: frame.conversation,
              endpoint: target, connectionId, timestamp: Date.now(),
            }));
            return;
          }
          const parsed = frame.message;
          const sceneId = parsed.id || owner;
          // ADR 0064 D12 (revised): a hosted file may only be sent in the conversation it was uploaded
          // in, by its uploader, with a genuine unexpired link. Anything else is refused and audited.
          const mediaRefusal = this.#hostedMediaRefusal(parsed.content, { type: parsed.type, id: sceneId }, connection.principal);
          if (mediaRefusal) {
            this.#logger.warn(formatCompact({ op: 'sandbox_media_inbound_rejected', target, connectionId,
              actor: sandboxMediaActor(connection.principal), conversation: `${parsed.type}:${sceneId}`, reason: mediaRefusal }));
            socket.send(JSON.stringify({
              type: 'error', code: 'sandbox_media_rejected', endpoint: target, connectionId,
              id: sceneId, conversation: { type: parsed.type, id: sceneId }, ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
              content: [{ type: 'text', data: { text: messages(this.#locale, 'mediaRejected') } }],
              timestamp: Date.now(),
            }));
            return;
          }
          void this.#emitPlatformEvent('message', raw);
          const conversation = { ...sandboxInboundConversation(String(this.#options.id), {
            type: parsed.type,
            id: sceneId,
          }), endpoint: this[endpointSpec].identity };
          const speaker = await this.#speaker(parsed.asMe === true, consoleUser, connection.principal, conversation);
          // The socket closed (or its principal was revoked) while the identity was being created.
          if (closed) return;
          // The id the page chose (shown as typed); the Runtime only ever sees the speaker's real
          // identity or the reserved simulated id, never a client-chosen id that could hold a role.
          const clientSenderId = parsed.senderId || owner;
          const senderId = speaker.identity ? speaker.identity.userId : sandboxSimulatedSenderId(clientSenderId);
          const senderName = speaker.identity ? (consoleUser?.displayName || speaker.identity.userId) : (parsed.senderName || clientSenderId);
          this.#logger.debug(formatCompact({
            op: 'sandbox_recv',
            target,
            sender: senderId,
            channelType: parsed.type,
            channelId: sceneId,
            text: parsed.text.slice(0, 80),
          }));
          const scene: SandboxConversation = { type: conversation.kind as SandboxConversation['type'], id: sceneId };
          subscription.conversation = scene;
          const messageId = parsed.messageId ?? randomUUID();
          this.#broadcast(this.#subscribers(scene, true), JSON.stringify({
            ...scene, conversation: scene, direction: 'inbound', senderId,
            displaySenderId: speaker.identity ? speaker.identity.userId : clientSenderId,
            simulated: !speaker.identity,
            ...(speaker.unavailable ? { asMeUnavailable: speaker.unavailable } : {}),
            ...(speaker.error ? { asMeError: speaker.error } : {}),
            ...(speaker.identity || parsed.senderName ? { senderName } : {}),
            ...(parsed.senderRole ? { senderRole: parsed.senderRole } : {}),
            ...sandboxSenderRoleFacts(this.#options.chatRoles, conversation, senderId),
            messageId, endpoint: this.#options.defaults.id, content: parsed.content, timestamp: parsed.timestamp,
          }));
          // ADR 0056 §1: the simulated group role is a platform standing (master = 群主). It never
          // grants framework roles; those come from the runtime (account owner / chat roles).
          const standing: PlatformStandingLevel | undefined = parsed.senderRole === 'master' ? 'owner' : parsed.senderRole;
          const sender = {
            id: senderId,
            name: senderName,
            ...(standing && conversation.kind !== 'private' ? { platform: { standing } } : {}),
          };
          void this[endpointSpec].events.message({
            event: raw,
            ...(typeof parsed.timestamp === 'number' ? { platformSentAt: parsed.timestamp } : {}),
            conversation,
            message: { conversation, id: messageId },
            content: parsed.text,
            segments: parsed.content,
            sender,
            endpointId: target,
            metadata: Object.freeze({
              type: parsed.type,
              channelType: parsed.type,
              channelId: parsed.id || owner,
              elements: parsed.content,
              timestamp: parsed.timestamp,
              ...(parsed.senderRole ? { senderRole: parsed.senderRole } : {}),
              ...(parsed.action ? { action: parsed.action } : {}),
              ...(parsed.agentRun ? { sandboxAgentRun: parsed.agentRun } : {}),
            }),
          }).catch((err) => {
            const error = err instanceof Error ? err.message : String(err);
            this.#logger.warn(formatCompact({
              op: 'sandbox_gateway_receive_failed',
              target,
              error,
            }));
            // #1250 sandbox-submitted-without-feedback: the page shows the failure next to the
            // input (a clicked button's card) instead of a silent 「已提交」.
            try {
              socket.send(JSON.stringify({
                type: 'error', code: 'sandbox_gateway_receive_failed', endpoint: target, connectionId,
                id: scene.id, conversation: scene, messageId,
                content: [{ type: 'text', data: { text: messages(this.#locale, 'receiveFailed', { error: error.slice(0, 200) }) } }],
                timestamp: Date.now(),
              }));
            } catch { /* silent-ok: the socket is gone; the run log keeps the failure */ }
          });
        })).catch((error: unknown) => {
          this.#logger.debug(formatCompact({ op: 'sandbox_receive_failed', error: error instanceof Error ? error.message : String(error) }));
        });
      },
      onClose: () => {
        closed = true;
        void this.#emitPlatformEvent('connection.close', { target, owner });
        const current = this.connectionRecords.get(connectionId);
        if (current === subscription) {
          current.release();
          this.connectionRecords.delete(connectionId);
          this.#logger.debug(formatCompact({ op: 'sandbox_ws_closed', target, connectionId }));
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
    this.connectionRecords.set(connectionId, subscription);
    void this.#emitPlatformEvent('connection.open', { target, owner, socket });
    this.#logger.debug(formatCompact({ op: 'sandbox_ws_connected', target, owner }));
    this.#readiness.afterProbe((shellIsolation) => {
      const current = this.connectionRecords.get(connectionId);
      if (!current || current.socket !== socket) return;
      const readyPayload = JSON.stringify({
        type: 'ready',
        protocol: 'scoped-conversations-v1',
        connectionId,
        conversation: subscription.conversation,
        locale: this.#locale,
        id: owner,
        endpoint: target,
        workingDirectory: process.cwd(),
        canExecute,
        // Whether 「以我的聊天身份发言」 can work on this socket (a signed-in Console user).
        consoleUser: consoleUser !== undefined,
        shellIsolation,
        content: [{
          type: 'text',
          data: {
            text: [
              messages(this.#locale, 'connected', { target }),
              messages(this.#locale, 'protocol', { path: this.wsPathValue }),
              messages(this.#locale, 'profile'),
            ].join('\n'),
          },
        }],
        timestamp: Date.now(),
      });
      whenWsOpen(socket, () => socket.send(readyPayload));
    });
  }

  /**
   * ADR 0060 §5.4: the identity a message speaks as. Only on request, only for a signed-in Console
   * user holding `self.chat-identity` (the threshold of `chat-identities.simulated.ensure`;
   * otherwise `needs-self-chat-identity`), and only an identity of the person linked to that user on
   * this adapter (`consoleSpeaker`).
   * #1250 sandbox-speak-as-me: when the user has none yet, it is created here
   * ({@link SandboxEndpointOptions.consoleSpeaker}: the person, its Console link and
   * `console-<userId>`, the same write as `chat-identities.simulated.ensure`; it is handed the
   * socket's principal object unchanged, which the Root accepts only because its own Host issued it,
   * and reads the permissions from), so the page's default 「以我的聊天身份发言」 works on the first
   * message without a separate request. A failure or a wait longer than
   * {@link SANDBOX_CONSOLE_SPEAKER_TIMEOUT_MS} is reported (`identity-failed` with the reason) and the
   * message goes out simulated.
   * A person who holds a global grant is spoken as only by a caller with global `iam.manage`;
   * otherwise the message goes out as a simulated, role-less sender (`needs-global-iam`), the
   * same rule `chat-identities.simulated.ensure` applies when it creates the identity.
   */
  async #speaker(asMe: boolean, user: SandboxConsoleUser | undefined, principal: WsConnection['principal'],
    conversation: Parameters<ChatRoleReader['factsOf']>[0]):
    Promise<{ readonly identity?: { readonly adapter: string; readonly userId: string }; readonly unavailable?: SandboxAsMeUnavailableReason; readonly error?: string }> {
    if (!asMe) return {};
    if (!user) return { unavailable: 'no-console-user' };
    if (!user.canUseChatIdentity) return { unavailable: 'needs-self-chat-identity' };
    const roles = this.#options.chatRoles;
    const speaker = (canManageGlobal: boolean) => {
      try { return roles?.consoleSpeaker?.(conversation, user.userId, { canManageGlobal }); } catch { return undefined; }
    };
    const identity = speaker(user.canManageGlobal);
    if (identity) return { identity };
    // Tell 「the person holds global grants」 apart from 「no identity yet」.
    if (!user.canManageGlobal && speaker(true)) return { unavailable: 'needs-global-iam' };
    const port = this.#options.consoleSpeaker;
    if (!port) return { unavailable: 'no-identity' };
    const timeoutMs = this.#options.consoleSpeakerTimeoutMs ?? SANDBOX_CONSOLE_SPEAKER_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        port.ensure(conversation, principal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(messages(this.#locale, 'asMeTimeout', { seconds: Math.ceil(timeoutMs / 1000) }))), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/gu, ' ').slice(0, 200);
      this.#logger.warn(formatCompact({ op: 'sandbox_console_identity_failed', user: user.userId, error: message }));
      return { unavailable: 'identity-failed', error: message };
    } finally { if (timer) clearTimeout(timer); }
    const created = speaker(user.canManageGlobal);
    return created ? { identity: created } : { unavailable: 'no-identity' };
  }

  /** Why a hosted file in an inbound message is refused, or undefined when every one is admitted. */
  #hostedMediaRefusal(content: readonly unknown[], scene: { readonly type: string; readonly id: string },
    principal: WsConnection['principal']): string | undefined {
    if (carriesLocalMediaPath(content)) return 'local_path';
    const uploader = sandboxMediaActor(principal);
    for (const value of segmentStrings(content)) {
      if (!isSandboxMediaPath(value)) continue;
      const decision = this.#media.authorize(value, {
        conversation: { endpoint: this.#options.defaults.id, type: scene.type as 'private', id: scene.id }, uploader,
      });
      if (!decision.ok) return decision.reason;
    }
    return undefined;
  }

  #sweepMedia(): void {
    try {
      const removed = this.#media.sweep();
      if (removed) this.#logger.debug(formatCompact({ op: 'sandbox_media_swept', removed }));
    } catch (error) {
      this.#logger.warn(formatCompact({ op: 'sandbox_media_sweep_failed', error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** @internal Tests and the I2 local source read the store directly, never over HTTP. */
  get mediaStore(): SandboxMediaStore {
    return this.#media;
  }

  #ensurePlaceholder(name: string, owner: string): void {
    if (this.connectionRecords.has(name)) return;
    this.connectionRecords.set(name, {
      connectionId: name,
      canExecute: false,
      scoped: false,
      conversation: { type: 'private', id: owner },
      target: name,
      owner,
      socket: { send: () => undefined, close: () => undefined },
      release: () => undefined,
      placeholder: true,
    });
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'sandbox_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

const SHELL_ISOLATION_PROBE_TIMEOUT_MS = 500;
/** Hard ceiling for the ready gate even if the Docker CLI ignores SIGTERM or a child keeps stdio open. */
const SHELL_ISOLATION_PROBE_DEADLINE_MS = 750;

function probeShellIsolation(): Promise<ShellIsolationStatus> {
  return new Promise<ShellIsolationStatus>((resolve) => {
    let settled = false;
    const settleRef: { clear?: () => void } = {};
    const settle = (status: ShellIsolationStatus): void => {
      if (settled) return;
      settled = true;
      settleRef.clear?.();
      resolve(status);
    };
    const child = execFile('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8',
      timeout: SHELL_ISOLATION_PROBE_TIMEOUT_MS,
    }, (error, stdout) => {
      if (!error) {
        const version = stdout.trim();
        settle(Object.freeze({
          available: true,
          provider: 'docker',
          message: version ? `Docker ${version}` : 'Docker ready',
        }));
        return;
      }
      settle(Object.freeze({
        available: false,
        provider: 'docker',
        message: error.killed || error.code === 'ETIMEDOUT'
          ? 'Docker readiness check timed out'
          : 'Docker daemon is unavailable',
      }));
    });
    // execFile only reports after the child's stdio closes; a hung CLI must not hold `ready` hostage.
    const deadline = setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      settle(Object.freeze({ available: false, provider: 'docker', message: 'Docker readiness check timed out' }));
    }, SHELL_ISOLATION_PROBE_DEADLINE_MS);
    deadline.unref?.();
    settleRef.clear = () => clearTimeout(deadline);
  }).catch(() => Object.freeze({
    available: false,
    provider: 'docker' as const,
    message: 'Docker is unavailable',
  }));
}
