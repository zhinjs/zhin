import {
  capabilityId,
  type CapabilityId,
  type FeatureId,
  type PluginId,
} from './identity.js';

export interface CapabilitySlot<T = unknown> {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly feature: FeatureId;
  readonly localName: string;
  readonly source: string;
  readonly definition: T;
}

export function createCapabilitySlot<T>(
  input: Omit<CapabilitySlot<T>, 'id'>,
): Readonly<CapabilitySlot<T>> {
  return Object.freeze({
    ...input,
    id: capabilityId(input.owner, input.feature, input.localName),
  });
}
