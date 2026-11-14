import {
  ProviderError, type ExecutionBinding, type InferencePurpose, type ModelKind, type ProfileRef,
  type ProviderCallContext, type ProviderGraph, type ScopedModelSelection, type ProfileView, type ProfileSelection, type ProviderSelectionSource, type DecisionPurpose,
} from './types.js';

export interface ResolveProviderProfileInput<K extends ModelKind> {
  readonly graph: ProviderGraph;
  readonly context: ProviderCallContext;
  readonly kind: K;
  readonly profile?: ProfileRef<K>;
  readonly purpose?: InferencePurpose;
}
interface SelectedProfile { readonly id: string; readonly source: ProviderSelectionSource }
function selectedProfiles(graph: ProviderGraph, context: ProviderCallContext, purpose: InferencePurpose): readonly SelectedProfile[] {
  const policy = graph.purposes;
  const entry = (id: string | undefined, source: ProviderSelectionSource): SelectedProfile[] => id ? [{ id, source: Object.freeze(source) }] : [];
  // Primary first, then its ordered fallbacks, all attributed to the layer that chose the primary (#1250).
  const chain = (id: string | undefined, fallbacks: readonly string[] | undefined, source: ProviderSelectionSource): SelectedProfile[] => {
    if (!id) return [];
    const frozen = Object.freeze(source);
    return [id, ...(fallbacks ?? [])].map(candidate => ({ id: candidate, source: frozen }));
  };
  if (purpose === 'summary' || purpose === 'ambient') {
    const own = policy.defaults[purpose];
    return own ? chain(own, policy.defaults[`${purpose}Fallbacks`], { level: 'default', purpose })
      : chain(policy.defaults.chat, policy.defaults.chatFallbacks, { level: 'default', purpose, inheritedFrom: 'chat' });
  }
  if (purpose === 'image') return entry(policy.defaults.image, { level: 'default', purpose });
  if (purpose.startsWith('agent:')) {
    const name = purpose.slice(6);
    return chain(policy.agents?.[name], policy.agentFallbacks?.[name], { level: 'agent', name });
  }
  if (purpose.startsWith('decision:')) {
    const task = purpose.slice(9) as DecisionPurpose;
    return entry(policy.decisions?.[task]?.profile, { level: 'decision', task });
  }
  let selected: ScopedModelSelection = policy.defaults;
  let source: ProviderSelectionSource = { level: 'default', purpose };
  const layers = [
    { level: 'adapter' as const, key: context.adapterKey, values: context.adapterKey ? policy.adapters?.[context.adapterKey] : undefined },
    { level: 'endpoint' as const, key: context.endpointKey, values: context.endpointKey ? policy.endpoints?.[context.endpointKey] : undefined },
    { level: 'scene' as const, key: context.sceneKey, values: purpose === 'chat' && context.sceneKey ? policy.scenes?.[context.sceneKey] : undefined },
  ];
  for (const layer of layers) {
    if (!layer.values || !layer.key) continue;
    if (purpose === 'chat' ? layer.values.chat !== undefined : 'perception' in layer.values && layer.values.perception !== undefined) {
      source = { level: layer.level, key: layer.key };
    }
    selected = { ...selected, ...layer.values };
    // A layer that chooses `chat` also owns its chain: never pair it with an outer layer's fallbacks.
    if (layer.values.chat !== undefined) selected = { ...selected, chatFallbacks: layer.values.chatFallbacks };
  }
  if (purpose === 'chat') return context.sessionChat
    ? entry(context.sessionChat.id, { level: 'session' }) : chain(selected.chat, selected.chatFallbacks, source);
  return selected.perception ? [selected.perception.profile, ...(selected.perception.fallbacks ?? [])]
    .map(id => ({ id, source: Object.freeze(source) })) : [];
}
/**
 * Explicit configured candidates: the selected Profile first, then the ordered fallbacks
 * its own layer declares (perception and every language purpose, #1250). A session's
 * explicit chat choice carries no fallbacks.
 */
export function providerPurposeSelections(input: Readonly<{
  graph: ProviderGraph; context: ProviderCallContext; purpose: InferencePurpose;
}>): readonly Readonly<SelectedProfile>[] {
  return Object.freeze(selectedProfiles(input.graph, input.context, input.purpose).map(value => Object.freeze(value)));
}

export function providerPurposeProfiles(input: Readonly<{
  graph: ProviderGraph; context: ProviderCallContext; purpose: InferencePurpose;
}>): readonly string[] {
  return Object.freeze(providerPurposeSelections(input).map(value => value.id));
}
export function createProfileReference<K extends ModelKind>(input: Readonly<{
  binding: ExecutionBinding; kind: K;
}>): ProfileRef<K> {
  if (!input.binding.model.kinds.includes(input.kind)) throw new ProviderError('unsupported-capability');
  return Object.freeze({ id: input.binding.profile.id, rootId: input.binding.profile.rootId,
    revision: input.binding.profile.revision, accountId: input.binding.account.id,
    accountIncarnation: input.binding.account.incarnation, kind: input.kind }) as ProfileRef<K>;
}
export function persistentProfileSelection<K extends ModelKind>(reference: ProfileRef<K>): ProfileSelection<K> {
  return Object.freeze({ id: reference.id, rootId: reference.rootId, accountId: reference.accountId,
    accountIncarnation: reference.accountIncarnation, kind: reference.kind });
}
/** Resolve one already-authorized scope; this function never creates or refreshes credentials. */
export function resolveProviderProfile<K extends ModelKind>(input: ResolveProviderProfileInput<K>): ExecutionBinding {
  const { graph, context, kind } = input;
  if (graph.rootId !== context.rootId) throw new ProviderError('forbidden');
  const reference = input.profile;
  const selection = input.purpose === 'chat' && !reference ? context.sessionChat : undefined;
  const selected = input.purpose ? selectedProfiles(graph, context, input.purpose)[0] : undefined;
  const id = reference?.id ?? selection?.id ?? selected?.id;
  const source: ProviderSelectionSource | undefined = reference ? { level: 'profile', profileId: reference.id }
    : selection ? { level: 'session' } : selected?.source;
  if (!id) throw new ProviderError('not-configured');
  const profile = Object.hasOwn(graph.profiles, id) ? graph.profiles[id] : undefined;
  if (!profile) throw new ProviderError('profile-not-found');
  const account = graph.accounts[profile.accountId];
  const service = account && graph.services[account.serviceId];
  if (!account || !service) throw new ProviderError('invalid-graph');
  if ((profile.ownerId !== context.ownerId && profile.ownerId !== context.hostOwnerId)
    || profile.ownerId !== account.ownerId
    || (service.ownerId !== account.ownerId && service.ownerId !== context.hostOwnerId)) throw new ProviderError('forbidden');
  if (input.purpose && input.purpose !== 'chat' && profile.ownerId !== context.hostOwnerId) throw new ProviderError('forbidden');
  if (reference && (reference.rootId !== graph.rootId || reference.kind !== kind || reference.revision !== profile.revision
    || reference.accountId !== account.id || reference.accountIncarnation !== account.incarnation)) throw new ProviderError('stale-reference');
  if (selection && (selection.rootId !== graph.rootId || selection.kind !== kind
    || selection.accountId !== account.id || selection.accountIncarnation !== account.incarnation)) throw new ProviderError('stale-reference');
  const model = service.models[profile.model];
  if (!model?.kinds.includes(kind)) throw new ProviderError('unsupported-capability');
  return Object.freeze({ graphRevision: graph.revision, ...(source ? { source: Object.freeze(source) } : {}), profile, account, service, model });
}
export function profileView<K extends ModelKind>(input: Readonly<{ binding: ExecutionBinding; kind: K }>): ProfileView<K> {
  const { binding } = input;
  return Object.freeze({ reference: createProfileReference(input), label: binding.profile.label ?? binding.profile.id,
    model: binding.profile.model, accountId: binding.account.id, serviceId: binding.service.id, definition: binding.model });
}
