import {
  createCapabilitySlot,
  type CapabilityId,
  type CapabilitySlot,
  type FeatureId,
  type SetupCapabilityRegistration,
} from '@zhin.js/plugin-runtime';
import type { CapabilityRoot, FeatureProvider } from '@zhin.js/feature-kit';

export function mergeSetupCapabilities(
  capabilities: Map<CapabilityId, CapabilitySlot>,
  registrations: readonly Readonly<SetupCapabilityRegistration>[],
  providers: ReadonlyMap<FeatureId, FeatureProvider>,
  rootsByFeature: ReadonlyMap<FeatureId, readonly CapabilityRoot[]>,
): void {
  for (const registration of registrations) {
    const provider = providers.get(registration.feature);
    const mounted = rootsByFeature.get(registration.feature)?.some(
      (root) => root.owner === registration.owner,
    );
    if (!provider || !mounted) {
      throw new Error(
        `Feature ${registration.feature} is not mounted for Plugin ${registration.owner}`,
      );
    }
    const definition = provider.authoring.validate(registration.definition, {
      owner: registration.owner,
      feature: registration.feature,
      localName: registration.localName,
      source: registration.source,
    });
    addCapabilitySlot(capabilities, createCapabilitySlot({
      owner: registration.owner,
      feature: registration.feature,
      localName: registration.localName,
      source: registration.source,
      definition,
      origin: 'setup',
    }));
  }
}

export function addCapabilitySlot(
  capabilities: Map<CapabilityId, CapabilitySlot>,
  slot: Readonly<CapabilitySlot>,
): void {
  if (capabilities.has(slot.id)) {
    throw new Error(`Duplicate Capability Slot: ${slot.id}`);
  }
  capabilities.set(slot.id, slot);
}

export function featureSetupAliases(
  providers: Iterable<FeatureProvider>,
): ReadonlyMap<string, FeatureId> {
  const aliases = new Map<string, FeatureId>();
  for (const provider of providers) {
    const method = provider.authoring.setupMethod;
    if (!method) continue;
    const existing = aliases.get(method);
    if (existing && existing !== provider.id) {
      throw new Error(`Duplicate Feature setup method ${method}: ${existing}, ${provider.id}`);
    }
    aliases.set(method, provider.id);
  }
  return aliases;
}
