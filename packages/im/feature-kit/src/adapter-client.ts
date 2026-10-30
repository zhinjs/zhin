/**
 * Open type registry populated by platform adapter packages.
 *
 * One adapter augments this interface once; every authoring Feature then
 * derives the same Client and native event types from its literal `adapter`.
 */
/** @deprecated New platforms augment AdapterRegistry with their Adapter type. */
export interface AdapterClientRegistry {
  // Augmented by platform adapter packages.
}

export interface AdapterClientTypes<TClient = unknown, TEvents extends object = Record<string, unknown>> {
  readonly client: TClient;
  readonly events: TEvents;
}

/** Canonical registry: new adapters register their Adapter class here once.
 * Legacy Client descriptors remain accepted through the same registry during migration. */
export interface AdapterRegistry extends AdapterClientRegistry {}

export type RegisteredAdapterName = Extract<keyof AdapterRegistry, string>;
export type EndpointOf<TAdapter> = TAdapter extends { getEndpoint(...args: never[]): infer TEndpoint }
  ? NonNullable<TEndpoint> : unknown;
export type EventsOf<TAdapter> = TAdapter extends { readonly adapterEvents: infer TEvents extends object }
  ? TEvents : TAdapter extends AdapterClientTypes<unknown, infer TEvents> ? TEvents : Record<string, unknown>;
export type AdapterInstance<TAdapter extends string | undefined> = TAdapter extends keyof AdapterRegistry
  ? AdapterRegistry[TAdapter] extends { getEndpoint(...args: never[]): unknown } ? AdapterRegistry[TAdapter] : unknown
  : unknown;
export type AdapterClient<TAdapter extends string | undefined> = TAdapter extends keyof AdapterRegistry
  ? AdapterRegistry[TAdapter] extends { getEndpoint(...args: never[]): infer TEndpoint } ? NonNullable<TEndpoint>
    : AdapterRegistry[TAdapter] extends AdapterClientTypes<infer TClient, object> ? TClient : unknown
  : unknown;
export type AdapterEvents<TAdapter extends string | undefined> = TAdapter extends keyof AdapterRegistry
  ? EventsOf<AdapterRegistry[TAdapter]> : Record<string, unknown>;

/** Runtime-only Client accessor carried by the current operation. */
export interface OperationClientPort {
  readonly adapter: string;
  get(): unknown;
}

interface ClientSource {
  readonly clientAdapter?: unknown;
  readonly $client?: unknown;
}

/** Read a Client lazily and fail closed when the declared adapter differs. */
export function readOperationClient(
  source: unknown,
  expectedAdapter?: string,
): unknown {
  const candidate = clientSource(source);
  if (!candidate) {
    if (expectedAdapter) {
      throw new Error(
        `Adapter ${expectedAdapter} Client is unavailable outside its IM operation`,
      );
    }
    return undefined;
  }
  const actualAdapter = typeof candidate.clientAdapter === 'string'
    ? candidate.clientAdapter
    : undefined;
  if (expectedAdapter && actualAdapter && expectedAdapter !== actualAdapter) {
    throw new Error(
      `Adapter ${expectedAdapter} cannot access ${actualAdapter} Client`,
    );
  }
  return candidate.$client;
}

/** Resolve the adapter identity without reading the lazy Client getter. */
export function operationClientAdapter(source: unknown): string | undefined {
  const candidate = clientSource(source);
  return typeof candidate?.clientAdapter === 'string' && candidate.clientAdapter.length > 0
    ? candidate.clientAdapter
    : undefined;
}

function clientSource(source: unknown): ClientSource | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = source as ClientSource & { readonly input?: unknown };
  if ('clientAdapter' in value || '$client' in value) return value;
  if (value.input && typeof value.input === 'object') return clientSource(value.input);
  return undefined;
}
