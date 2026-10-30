/** Account configuration fields. Canonical identity is supplied separately by owning Adapter metadata. */
export interface ConfiguredEndpointEntry {
  readonly id: string;
  readonly [key: string]: unknown;
}
