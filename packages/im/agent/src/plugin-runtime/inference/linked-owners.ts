import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { PersonalSessionOwner } from '../../personal-session/index.js';

/** A platform identity as chat roles name it: adapter instance alias + platform user id (ADR 0060 §2.2). */
export interface LinkedChatIdentity {
  readonly adapter: string;
  readonly userId: string;
}

type AdapterSnapshot = Pick<RuntimeSnapshot, 'projections' | 'tree'>;

/**
 * ADR 0060 §2.4 / P3: the personal inference owners of a person, from its chat identities — one
 * per account (endpoint) of each identity's adapter instance, addressed exactly like the inference
 * targets (`createInferenceTargetsReader`). The owner's `rootId` is the current Host's, so a moved
 * project keeps its links (only the personal data under the old `rootId` stays behind, Q9).
 */
export function personalOwnersOfIdentities(input: Readonly<{
  rootId: string;
  snapshot: AdapterSnapshot | undefined;
  identities: readonly LinkedChatIdentity[];
}>): readonly PersonalSessionOwner[] {
  const index = input.snapshot?.projections.get(adapterFeatureId);
  if (!input.snapshot || !isAdapterIndex(index) || !input.identities.length) return Object.freeze([]);
  const owners: PersonalSessionOwner[] = [];
  for (const adapter of index.adapters()) {
    const alias = input.snapshot.tree.get(adapter.descriptor.owner)?.instanceKey;
    const subjects = input.identities.filter(identity => identity.adapter === alias);
    if (!subjects.length) continue;
    for (const endpoint of adapter.list()) {
      for (const subject of subjects) {
        owners.push(Object.freeze({ rootId: input.rootId, platform: adapter.descriptor.name, endpoint: endpoint.endpointId,
          adapterId: String(endpoint.canonicalId), subjectId: subject.userId }));
      }
    }
  }
  return Object.freeze(owners);
}

/**
 * The chat identity a configured personal owner (`ai.personalPrincipals`) names: its adapter
 * capability entry id converted to the adapter instance alias of the snapshot. Undefined while
 * that adapter is not loaded. `rootId` is ignored (ADR 0060 §4.1: a moved project still imports).
 */
export function chatIdentityOfPersonalOwner(snapshot: AdapterSnapshot | undefined, owner: Pick<PersonalSessionOwner, 'adapterId' | 'subjectId'>): LinkedChatIdentity | undefined {
  const index = snapshot?.projections.get(adapterFeatureId);
  if (!snapshot || !isAdapterIndex(index) || typeof owner.subjectId !== 'string' || !owner.subjectId) return undefined;
  for (const adapter of index.adapters()) {
    const matches = String(adapter.descriptor.id) === owner.adapterId
      || adapter.list().some(endpoint => String(endpoint.canonicalId) === owner.adapterId);
    if (!matches) continue;
    const alias = snapshot.tree.get(adapter.descriptor.owner)?.instanceKey;
    return alias ? Object.freeze({ adapter: alias, userId: owner.subjectId }) : undefined;
  }
  return undefined;
}
