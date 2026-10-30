import type { AdapterClient, AdapterEvents, AdapterInstance } from './adapter-client.js';

export interface OperationSceneAddress {
  readonly endpoint: Readonly<{ id: string; adapter: string }>;
  readonly id: string;
  readonly parent?: Readonly<{ kind: 'private' | 'group' | 'channel'; id: string }>;
  readonly threadId?: string;
  readonly name?: string;
}
export type OperationScene =
  | (OperationSceneAddress & Readonly<{ kind: 'private' }>)
  | (OperationSceneAddress & Readonly<{ kind: 'group' }>)
  | (OperationSceneAddress & Readonly<{ kind: 'channel' }>);
export interface OperationSender {
  readonly id: string;
  readonly name?: string;
  readonly platformRoles?: readonly string[];
  readonly authorizationRoles?: readonly string[];
}
export interface OperationMessageRef {
  readonly conversation: OperationScene;
  readonly id: string;
}
export interface OperationMessage {
  readonly ref?: OperationMessageRef;
  /** Canonicalized message id, which an adapter may derive when a native id is absent. */
  readonly id?: string;
  readonly text: string;
  readonly segments?: readonly Readonly<{ type: string; data: Readonly<Record<string, unknown>> }>[];
  readonly receivedAt: number;
  readonly platformSentAt?: number;
  readonly mentioned?: boolean;
  readonly replyTo?: Readonly<{ id: string }>;
}

/** One read-only view of the current inbound operation; never persisted or reconstructed from metadata. */
export interface OperationSession<TAdapter extends string | undefined = undefined> {
  readonly adapterName: TAdapter extends string ? TAdapter : string;
  readonly adapter: AdapterInstance<TAdapter>;
  readonly endpoint: AdapterClient<TAdapter>;
  readonly scene: OperationScene;
  readonly sender?: OperationSender;
  readonly message: OperationMessage;
  /** The SDK callback's original object, including its prototype and methods. */
  readonly event: AdapterEvents<TAdapter>[keyof AdapterEvents<TAdapter>];
  readonly signal: AbortSignal;
  reply(content: unknown): Promise<unknown>;
}

/** @internal Bound by Core to the same captured message fields and resource lease. */
export const operationSession = Symbol.for('zhin.operation-session/1');
export interface OperationSessionSource {
  [operationSession](): OperationSession<string> | undefined;
}

/** Reads only the operation hook. Similarly named payload/metadata fields confer no context. */
export function readOperationSession(source: unknown, expectedAdapter?: string): OperationSession<string> | undefined {
  const seen = new Set<object>();
  const read = (input: unknown): OperationSession<string> | undefined => {
    if (!input || typeof input !== 'object' || seen.has(input)) return undefined;
    seen.add(input);
    const candidate = input as Partial<OperationSessionSource> & { readonly input?: unknown; readonly payload?: unknown };
    const hook = candidate[operationSession];
    if (typeof hook === 'function') {
      const session = hook.call(input);
      if (session && expectedAdapter && session.adapterName !== expectedAdapter) {
        throw new Error(`Adapter ${expectedAdapter} cannot access ${session.adapterName} Session`);
      }
      return session;
    }
    return read(candidate.input) ?? read(candidate.payload);
  };
  return read(source);
}
