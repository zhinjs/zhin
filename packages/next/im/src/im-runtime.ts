import {
  Scope,
  createToken,
  type RuntimeSnapshot,
  type SnapshotStore,
} from '@zhin.js/next-kernel';
import { AdapterIndex, adapterFeatureId } from '@zhin.js/next-feature-adapter';
import { MiddlewareIndex, middlewareFeatureId } from '@zhin.js/next-feature-middleware';
import {
  Message,
  createOutboundEnvelope,
  type IncomingMessage,
  type MessageDispatchResult,
  type MessageGateway,
  type OutboundEnvelope,
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

  async #sendWithSnapshot(request: SendRequest, snapshot: RuntimeSnapshot): Promise<unknown> {
    const payload = await this.#renderer.render(request.content, request.requester, snapshot);
    const envelope = createOutboundEnvelope({
      adapter: request.adapter,
      target: request.target,
      requester: request.requester,
      generation: snapshot.generation,
    }, payload);
    let result: unknown;
    await runMiddleware<OutboundEnvelope>(
      snapshot,
      envelope,
      async () => {
        result = await requireAdapters(snapshot).send(request.adapter, {
          target: request.target,
          payload: envelope.payload,
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
  if (!(projection instanceof AdapterIndex)) {
    throw new Error('Adapter Feature projection is not installed');
  }
  return projection;
}

function middleware(snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const projection = snapshot.projections.get(middlewareFeatureId);
  return projection instanceof MiddlewareIndex ? projection : undefined;
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
