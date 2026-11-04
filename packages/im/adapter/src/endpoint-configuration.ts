import type { EndpointProfileConfiguration } from './endpoint-profile.js';

/** Account configuration fields. Canonical identity is supplied separately by owning Adapter metadata. */
export interface ConfiguredEndpointEntry extends EndpointProfileConfiguration {
  readonly id: string;
  readonly [key: string]: unknown;
}
