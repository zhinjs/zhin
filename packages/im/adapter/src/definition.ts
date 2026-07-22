import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { CapabilityContext } from '@zhin.js/feature-kit';
import type { EndpointManagement } from './endpoint-management.js';

const adapterBrand = 'zhin.adapter/1' as const;

export type AdapterCapability = 'inbound' | 'outbound';

export interface EndpointSendRequest {
  readonly target: string;
  readonly payload: unknown;
  readonly parent?: { readonly type?: string; readonly id?: string; readonly name?: string };
}

export interface EndpointInstance<TResult = unknown> {
  /** Optional platform-neutral Console/Host management surface. */
  readonly management?: EndpointManagement;
  /** Allocates transport resources but must not admit inbound events yet. */
  start?(): void | Promise<void>;
  /** Opens admission after the candidate generation has committed. */
  open?(): void;
  /** Stops new inbound events while preserving in-flight work. */
  close?(): void | Promise<void>;
  /** Releases transport resources. Calls must be idempotent. */
  stop?(): void | Promise<void>;
  send?(request: EndpointSendRequest): TResult | Promise<TResult>;
}

export interface AdapterContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly id: CapabilityId;
  readonly name: string;
}

export interface AdapterDefinition<TConfig = unknown, TResult = unknown> {
  readonly $feature: typeof adapterBrand;
  readonly capabilities: readonly AdapterCapability[];
  create(
    context: AdapterContext<TConfig>,
  ): EndpointInstance<TResult> | Promise<EndpointInstance<TResult>>;
}

export function defineAdapter<TConfig = unknown, TResult = unknown>(
  definition: Omit<AdapterDefinition<TConfig, TResult>, '$feature'>,
): Readonly<AdapterDefinition<TConfig, TResult>> {
  if (typeof definition.create !== 'function') {
    throw new TypeError('Adapter create must be a function');
  }
  const capabilities = [...new Set(definition.capabilities)];
  if (
    capabilities.length === 0
    || capabilities.some((value) => value !== 'inbound' && value !== 'outbound')
  ) {
    throw new TypeError('Adapter capabilities must contain inbound and/or outbound');
  }
  return Object.freeze({
    ...definition,
    $feature: adapterBrand,
    capabilities: Object.freeze(capabilities),
  });
}

export function parseAdapterDefinition(value: unknown): AdapterDefinition {
  if (!value || typeof value !== 'object') throw invalidAdapter();
  const definition = value as Partial<AdapterDefinition>;
  if (
    definition.$feature !== adapterBrand
    || typeof definition.create !== 'function'
    || !Array.isArray(definition.capabilities)
    || definition.capabilities.length === 0
    || definition.capabilities.some(
      (capability) => capability !== 'inbound' && capability !== 'outbound',
    )
  ) throw invalidAdapter();
  return definition as AdapterDefinition;
}

function invalidAdapter(): TypeError {
  return new TypeError('Adapter module must default-export defineAdapter(...)');
}
