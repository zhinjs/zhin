import { createToken } from '@zhin.js/plugin-runtime';

/** One canonical entry under `plugins.<adapterKey>.endpoints`. */
export interface ConfiguredEndpointEntry {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface AddConfiguredEndpointRequest {
  readonly adapterKey: string;
  readonly entry: ConfiguredEndpointEntry;
  /** Secret values keyed by the environment reference stored in `entry`. */
  readonly environment: Readonly<Record<string, string>>;
}

export interface EndpointConfigurationMutation {
  readonly filePath: string;
}

export interface RemoveConfiguredEndpointResult extends EndpointConfigurationMutation {
  readonly removed: boolean;
}

/**
 * Persistence boundary for endpoint management commands.
 *
 * Adapter packages own endpoint semantics. The process composition root owns
 * project-file discovery, serialization and secret persistence.
 */
export interface EndpointConfigurationStore {
  list(adapterKey: string): readonly ConfiguredEndpointEntry[];
  add(request: AddConfiguredEndpointRequest): EndpointConfigurationMutation;
  remove(adapterKey: string, endpointId: string): RemoveConfiguredEndpointResult;
}

export const endpointConfigurationStoreToken = createToken<EndpointConfigurationStore>(
  'zhin.endpoint-configuration-store',
  'Root-owned endpoint configuration persistence',
);
