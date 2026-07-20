import {
  Scope,
  createToken,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotStore,
} from '@zhin.js/plugin-runtime';
import { AdapterIndex, adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { MiddlewareIndex, isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import {
  Message,
  createOutboundEnvelope,
  type ChannelParent,
  type IncomingMessage,
  type MessageDispatchResult,
  type MessageGateway,
  type OutboundEnvelope,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import { MessageDispatcher } from './message-dispatcher.js';
import { OutboundRenderer } from './outbound-renderer.js';

export const messageGatewayToken = createToken<MessageGateway>('zhin.im.message-gateway');

export interface ImRuntimeOptions {
  readonly commandPrefix?: string;
  readonly renderer?: OutboundRenderer;
}

export class ImRuntime implements MessageGateway {
  readonly #dispatcher: MessageDispatcher;
  readonly #renderer: OutboundRenderer;
  #snapshots?: SnapshotStore;
  #unmatchedHandler?: (
    message: Message,
    snapshot: RuntimeSnapshot,
    requester: PluginId,
  ) => Promise<boolean>;

  constructor(options: ImRuntimeOptions = {}) {
    this.#dispatcher = new MessageDispatcher(options.commandPrefix);
    this.#renderer = options.renderer ?? new OutboundRenderer();
  }

  attach(snapshots: SnapshotStore): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  /**
   * Optional Host AI / fallback path after Command miss (or non-prefixed text).
   * Return true when the message was handled (reply already sent).
   * `requester` is the Adapter Endpoint owner (for CapabilityIngress inheritance).
   */
  setUnmatchedHandler(
    handler: (
      message: Message,
      snapshot: RuntimeSnapshot,
      requester: PluginId,
    ) => Promise<boolean>,
  ): void {
    this.#unmatchedHandler = handler;
  }

  install(resources: Scope): void {
    resources.provide(messageGatewayToken, this);
  }

  async receive(input: IncomingMessage): Promise<MessageDispatchResult> {
    const lease = this.#acquire();
    let active = true;
    try {
      const requester = requireAdapters(lease.value).owner(input.adapter);
      const message = new Message(
        input.adapter,
        input.target,
        input.content,
        lease.value.generation,
        (content, replyRequester = requester) => {
          if (!active) throw new Error('Message reply scope has ended');
          return this.#sendWithSnapshot({
            adapter: input.adapter,
            target: input.target,
            requester: replyRequester,
            content,
          }, lease.value);
        },
        input.id,
        input.sender,
        Object.freeze({ ...input.metadata }),
      );
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      await runMiddleware(
        lease.value,
        message,
        async () => {
          result = await this.#dispatcher.dispatch(message, lease.value);
          if (!result.matched && this.#unmatchedHandler) {
            const handled = await this.#unmatchedHandler(message, lease.value, requester);
            if (handled) {
              result = Object.freeze({ matched: true, command: 'ai', owner: requester });
            }
          }
        },
        'inbound',
      );
      return result;
    } finally {
      active = false;
      lease.release();
    }
  }

  async send(request: SendRequest): Promise<unknown> {
    const lease = this.#acquire();
    try {
      return await this.#sendWithSnapshot(request, lease.value);
    } finally {
      lease.release();
    }
  }

  /** Console `endpoint.list` — empty until Adapter Feature projection is ready. */
  listEndpoints(): readonly {
    readonly name: string;
    readonly adapter: string;
    readonly connected: boolean;
    readonly status: 'online' | 'offline';
    readonly phase: 'pending' | 'starting' | 'online' | 'failed' | 'unconfigured';
  }[] {
    try {
      const lease = this.#acquire();
      try {
        return requireAdapters(lease.value).describe().map((row) => Object.freeze({
          name: row.name,
          // adapter 列显示平台类型（owner 包名去 scope/adapter- 前缀），不是 slot localName
          adapter: adapterTypeName(lease.value.tree.get(row.owner)?.packageName) ?? row.name,
          connected: row.connected,
          status: row.status,
          phase: row.phase,
        }));
      } finally {
        lease.release();
      }
    } catch {
      return Object.freeze([]);
    }
  }

  getEndpoint(adapter: string, endpointId: string): {
    readonly name: string;
    readonly adapter: string;
    readonly connected: boolean;
    readonly status: 'online' | 'offline';
    readonly phase: 'pending' | 'starting' | 'online' | 'failed' | 'unconfigured';
  } | null {
    try {
      const lease = this.#acquire();
      try {
        const index = requireAdapters(lease.value);
        const id = index.resolve(adapter, endpointId);
        if (!id) return null;
        const row = index.describe().find((item) => item.id === id);
        if (!row) return null;
        return Object.freeze({
          name: row.name,
          adapter: row.name,
          connected: row.connected,
          status: row.status,
          phase: row.phase,
        });
      } finally {
        lease.release();
      }
    } catch {
      return null;
    }
  }

  async sendEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly channelId: string;
    readonly channelType: string;
    readonly content: unknown;
    readonly parent?: ChannelParent;
  }): Promise<{ messageId: string }> {
    const lease = this.#acquire();
    try {
      const index = requireAdapters(lease.value);
      const capabilityId = index.resolve(input.adapter, input.endpointId);
      if (!capabilityId) throw new Error('endpoint not found');
      const target = composeSendTarget(input.channelType, input.channelId);
      const content = normalizeConsoleContent(input.content);
      const result = await this.#sendWithSnapshot({
        adapter: capabilityId,
        target,
        requester: index.owner(capabilityId),
        content,
        ...(input.parent ? { parent: input.parent } : {}),
      }, lease.value);
      return { messageId: result == null ? '' : String(result) };
    } finally {
      lease.release();
    }
  }

  /** Activity-feedback: add a message reaction when the live Endpoint supports it. */
  async addEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly messageId: string;
    readonly emoji: string;
    readonly sceneType?: string;
    readonly channelId?: string;
  }): Promise<string | null> {
    const endpoint = this.#liveEndpoint(input.adapter, input.endpointId);
    if (!endpoint) return null;
    if (typeof endpoint.addReaction === 'function') {
      return endpoint.addReaction(input.messageId, input.emoji, {
        sceneType: input.sceneType,
        channelId: input.channelId,
      });
    }
    if (typeof endpoint.$addReaction === 'function') {
      return endpoint.$addReaction(input.messageId, input.emoji, {
        sceneType: input.sceneType,
        channelId: input.channelId,
      });
    }
    return null;
  }

  async removeEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly messageId: string;
    readonly reactionId: string;
  }): Promise<void> {
    const endpoint = this.#liveEndpoint(input.adapter, input.endpointId);
    if (!endpoint) return;
    if (typeof endpoint.removeReaction === 'function') {
      await endpoint.removeReaction(input.messageId, input.reactionId);
      return;
    }
    if (typeof endpoint.$removeReaction === 'function') {
      await endpoint.$removeReaction(input.messageId, input.reactionId);
    }
  }

  /** Activity-feedback autoRemove: recall a previously sent status message. */
  async recallEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly messageId: string;
  }): Promise<void> {
    const endpoint = this.#liveEndpoint(input.adapter, input.endpointId);
    if (!endpoint) return;
    if (typeof endpoint.recallMessage === 'function') {
      await endpoint.recallMessage(input.messageId);
      return;
    }
    if (typeof endpoint.$recallMessage === 'function') {
      await endpoint.$recallMessage(input.messageId);
    }
  }

  #liveEndpoint(adapter: string, endpointId: string): ReactionCapableEndpoint | null {
    try {
      const lease = this.#acquire();
      try {
        const endpoint = requireAdapters(lease.value).instance(adapter, endpointId);
        return (endpoint as ReactionCapableEndpoint | undefined) ?? null;
      } finally {
        lease.release();
      }
    } catch {
      return null;
    }
  }

  async #sendWithSnapshot(request: SendRequest, snapshot: RuntimeSnapshot): Promise<unknown> {
    const payload = await this.#renderer.render(request.content, request.requester, snapshot);
    const envelope = createOutboundEnvelope({
      adapter: request.adapter,
      target: request.target,
      requester: request.requester,
      generation: snapshot.generation,
      ...(request.parent ? { parent: request.parent } : {}),
    }, payload);
    let result: unknown;
    await runMiddleware<OutboundEnvelope>(
      snapshot,
      envelope,
      async () => {
        result = await requireAdapters(snapshot).send(request.adapter, {
          target: request.target,
          payload: envelope.payload,
          ...(request.parent ? { parent: request.parent } : {}),
        });
      },
      'outbound',
    );
    return result;
  }

  #acquire() {
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    return this.#snapshots.acquire();
  }
}

function requireAdapters(snapshot: RuntimeSnapshot): AdapterIndex {
  const projection = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(projection)) {
    throw new Error('Adapter Feature projection is not installed');
  }
  return projection;
}

/** Duck-typed reaction / recall surface on Runtime EndpointInstance (icqq, …). */
interface ReactionCapableEndpoint {
  addReaction?(
    messageId: string,
    emoji: string,
    hint?: { sceneType?: string; channelId?: string },
  ): Promise<string | null>;
  removeReaction?(messageId: string, reactionId: string): Promise<void>;
  $addReaction?(
    messageId: string,
    emoji: string,
    hint?: { sceneType?: string; channelId?: string },
  ): Promise<string | null>;
  $removeReaction?(messageId: string, reactionId: string): Promise<void>;
  recallMessage?(messageId: string): Promise<void>;
  $recallMessage?(messageId: string): Promise<void>;
}

/**
 * Build Adapter send target. If channelId already carries a scene prefix
 * (`private:uid` / `group:gid`), do not double-prefix.
 */
function composeSendTarget(channelType: string, channelId: string): string {
  const id = channelId.trim();
  if (!id) return channelType || '';
  if (/^(private|group|channel|direct|c2c|temp):/iu.test(id)) return id;
  return channelType ? `${channelType}:${id}` : id;
}

/** `@zhin.js/adapter-icqq` → `icqq`；非 adapter 包名原样返回。 */
function adapterTypeName(packageName: string | undefined): string | undefined {
  if (!packageName) return undefined;
  return packageName.replace(/^@[^/]+\/adapter-/, '');
}

function middleware(snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const projection = snapshot.projections.get(middlewareFeatureId);
  return isMiddlewareIndex(projection) ? projection : undefined;
}

async function runMiddleware<TInput>(
  snapshot: RuntimeSnapshot,
  input: TInput,
  terminal: () => Promise<void>,
  target: 'inbound' | 'outbound',
): Promise<void> {
  const index = middleware(snapshot);
  if (index) await index.run(input, terminal, target);
  else await terminal();
}

function normalizeConsoleContent(content: unknown): SendContent {
  if (typeof content === 'string') return content;
  // Array content passes through untouched, matching the legacy console RPC
  // contract (element arrays must not be stringified to '[object Object]').
  if (Array.isArray(content)) return content as SendContent;
  return String(content);
}
