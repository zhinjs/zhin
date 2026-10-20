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
  /** Setup-owned slots follow their Plugin Scope instead of file-slot HMR. */
  readonly origin?: 'setup';
}

/** A capability declared imperatively while its owning Plugin is assembled. */
export interface SetupCapabilityRegistration<T = unknown> {
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
