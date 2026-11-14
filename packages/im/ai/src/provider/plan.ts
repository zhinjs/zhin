import type { JsonValue } from '../decision/types.js';
import { createHash } from 'node:crypto';
import { normalizeProviderGraph, normalizeProviderJson } from './graph.js';
import {
  ProviderError, type ProviderGraph, type ProviderService, type ProviderAccount, type ModelProfile,
  type ProviderDriverReference, type ModelDefinition, type JsonObject, type PurposePolicy,
} from './types.js';

type ResourceKind = 'services' | 'accounts' | 'profiles';
export interface ProviderPlanBindings {
  readonly services?: Readonly<Record<string, string>>;
  readonly accounts?: Readonly<Record<string, string>>;
  readonly profiles?: Readonly<Record<string, string>>;
}
export interface ResolvePlanServiceInput {
  readonly driver: string | ProviderDriverReference;
  readonly options: JsonObject;
  readonly models: Readonly<Record<string, ModelDefinition>>;
  readonly requestedModels: readonly string[];
  readonly existing?: ProviderService;
}
export interface ResolvedPlanService {
  /** Same held Driver parses both values; absence conservatively treats all options as identity. */
  readonly identity?: (service: ProviderService) => JsonValue;
  readonly driver: ProviderDriverReference;
  readonly options: JsonObject;
  readonly models: Readonly<Record<string, ModelDefinition>>;
}
export interface ReviewProviderPlanOptions {
  readonly input: unknown;
  readonly graph: ProviderGraph;
  readonly ownerId: string;
  readonly hostOwnerId: string;
  /** Exact mappings must come from reviewed management input, never a name lookup. */
  readonly bindings?: ProviderPlanBindings;
  readonly createId: (kind: ResourceKind | 'incarnation') => string;
  /** Pure local driver/schema/catalog resolution. It must not contact a provider. */
  readonly resolveService: (input: ResolvePlanServiceInput) => ResolvedPlanService | Promise<ResolvedPlanService>;
  /** The same held Driver normalizes context-specific parameters; this callback has no I/O. */
  readonly validateProfile?: (input: Readonly<{ service: ProviderService; account: ProviderAccount; profile: ModelProfile }>) => JsonObject | Promise<JsonObject>;
}
export interface ReviewedProviderPlan {
  readonly rootId: string;
  readonly ownerId: string;
  readonly baseRevision: number;
  readonly fingerprint: string;
  readonly graph: ProviderGraph;
  readonly bindings: Readonly<Required<ProviderPlanBindings>>;
  readonly changes: Readonly<Record<ResourceKind, Readonly<{ created: readonly string[]; updated: readonly string[]; removed: readonly string[] }>>>;
}
function driverReference(input: unknown): string | ProviderDriverReference {
  if (typeof input === 'string') return text(input);
  const value = record(input); keys(value, ['id', 'owner', 'contractVersion']);
  return Object.freeze({ id: text(value.id), owner: text(value.owner), contractVersion: text(value.contractVersion) });
}
function invalid(): never { throw new ProviderError('invalid-plan'); }
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return input as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.includes(key))) invalid();
}
function text(input: unknown): string {
  if (typeof input !== 'string' || !input || input !== input.trim()) return invalid();
  return input;
}
function dictionary(input: unknown): Record<string, unknown> { return input === undefined ? Object.create(null) : record(input); }
function json(input: unknown): JsonObject {
  const raw = record(input === undefined ? {} : input);
  return normalizeProviderJson(raw) as JsonObject;
}
function canonical(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
  if (input && typeof input === 'object') {
    return `{${Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
  }
  return JSON.stringify(input);
}
export function providerPlanFingerprint(input: unknown): string {
  return createHash('sha256').update(canonical(normalizeProviderJson(input))).digest('hex');
}

/** Compile an explicit import into one complete graph, without applying it or logging in. */
/**
 * True when two Service identities differ only in `baseUrl`, and both addresses
 * share scheme, host and port (a path fix such as adding `/v1`).
 */
function sameOriginAddressChange(before: JsonValue, after: JsonValue): boolean {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return false;
  const { baseUrl: previousUrl, ...previousRest } = before as Record<string, JsonValue>;
  const { baseUrl: nextUrl, ...nextRest } = after as Record<string, JsonValue>;
  if (providerPlanFingerprint(previousRest) !== providerPlanFingerprint(nextRest)) return false;
  if (typeof previousUrl !== 'string' || typeof nextUrl !== 'string') return false;
  try {
    const a = new URL(previousUrl), b = new URL(nextUrl);
    return a.protocol === b.protocol && a.hostname.toLowerCase() === b.hostname.toLowerCase() && a.port === b.port
      && a.username === b.username && a.password === b.password;
  } catch {
    return false;
  }
}

export async function reviewProviderPlan(options: ReviewProviderPlanOptions): Promise<ReviewedProviderPlan> {
  const graph = normalizeProviderGraph(options.graph);
  const input = record(normalizeProviderJson(options.input));
  keys(input, ['version', 'services', 'accounts', 'profiles', 'purposes', 'remove']);
  if (input.version !== 1) return invalid();
  const ownerId = text(options.ownerId);
  const isHost = ownerId === options.hostOwnerId;
  const services: Record<string, ProviderService> = Object.assign(Object.create(null), graph.services);
  const accounts: Record<string, ProviderAccount> = Object.assign(Object.create(null), graph.accounts);
  const profiles: Record<string, ModelProfile> = Object.assign(Object.create(null), graph.profiles);
  const maps = { services: Object.assign(Object.create(null), options.bindings?.services),
    accounts: Object.assign(Object.create(null), options.bindings?.accounts), profiles: Object.assign(Object.create(null), options.bindings?.profiles) } as Record<ResourceKind, Record<string, string>>;
  const changes = Object.fromEntries((['services', 'accounts', 'profiles'] as const).map(kind => [kind, { created: [] as string[], updated: [] as string[], removed: [] as string[] }])) as Record<ResourceKind, { created: string[]; updated: string[]; removed: string[] }>;
  for (const kind of ['services', 'accounts', 'profiles'] as const) {
    for (const id of Object.values(maps[kind])) if (!Object.hasOwn(graph[kind], text(id))) throw new ProviderError('plan-conflict');
  }
  const allocate = (kind: ResourceKind, alias: string): string => {
    text(alias);
    const bound = maps[kind][alias];
    if (bound !== undefined) return bound;
    const id = text(options.createId(kind));
    if (Object.hasOwn(graph[kind], id) || Object.values(maps[kind]).includes(id)) throw new ProviderError('plan-conflict');
    maps[kind][alias] = id;
    return id;
  };
  const reference = (kind: ResourceKind, alias: unknown): string => {
    const id = maps[kind][text(alias)];
    if (!id) return invalid();
    return id;
  };
  const own = (resource: { ownerId: string } | undefined): void => {
    if (resource && resource.ownerId !== ownerId) throw new ProviderError('forbidden');
  };
  const retainRevision = <T extends { revision: number }>(previous: T | undefined, next: T): T => {
    return previous && canonical({ ...previous, revision: 0 }) === canonical({ ...next, revision: 0 }) ? previous : next;
  };
  const label = (value: unknown, previous: { label?: string } | undefined, alias: string): { label?: string } => {
    if (value !== undefined) return { label: text(value) };
    if (previous) return previous.label === undefined ? {} : { label: previous.label };
    return { label: alias };
  };
  const sourceServices = dictionary(input.services);
  const sourceAccounts = dictionary(input.accounts);
  const sourceProfiles = dictionary(input.profiles);
  for (const alias of Object.keys(sourceServices)) allocate('services', alias);
  for (const alias of Object.keys(sourceAccounts)) allocate('accounts', alias);
  for (const alias of Object.keys(sourceProfiles)) allocate('profiles', alias);

  for (const [alias, value] of Object.entries(sourceServices)) {
    const raw = record(value); keys(raw, ['driver', 'options', 'models', 'label']);
    const id = maps.services[alias], previous = graph.services[id]; own(previous);
    const requestedModels = Object.values(sourceProfiles).flatMap(value => {
      const profile = record(value), account = sourceAccounts[text(profile.account)];
      return account && record(account).service === alias ? [text(profile.model)] : [];
    });
    const requestedDriver = driverReference(raw.driver);
    const resolved = await options.resolveService({ driver: requestedDriver, options: json(raw.options),
      models: (raw.models ?? {}) as Readonly<Record<string, ModelDefinition>>, requestedModels, existing: previous });
    if (typeof requestedDriver !== 'string' && canonical(requestedDriver) !== canonical(resolved.driver)) {
      throw new ProviderError('driver-contract-mismatch');
    }
    const { identity, ...definition } = resolved;
    const candidate: ProviderService = { id, rootId: graph.rootId, ownerId, revision: (previous?.revision ?? 0) + 1,
      ...label(raw.label, previous, alias), ...definition };
    if (previous && canonical(previous.driver) !== canonical(candidate.driver)) throw new ProviderError('plan-conflict');
    if (previous) {
      const before = identity ? identity(previous) : previous.options;
      const after = identity ? identity(candidate) : candidate.options;
      // #1250 service-baseurl-immutable: credentials are bound to accounts, and an account's
      // key must never be sent to another host. An unreferenced Service has no key to leak; a
      // referenced one may only change the URL path (same scheme, host and port).
      if (providerPlanFingerprint(before) !== providerPlanFingerprint(after)
        && Object.values(graph.accounts).some(account => account.serviceId === id)
        && !sameOriginAddressChange(before, after)) {
        throw new ProviderError('service-origin-change');
      }
    }
    services[id] = retainRevision(previous, candidate);
    if (services[id] !== previous) changes.services[previous ? 'updated' : 'created'].push(id);
  }
  for (const [alias, value] of Object.entries(sourceAccounts)) {
    const raw = record(value); keys(raw, ['service', 'auth', 'label']);
    const id = maps.accounts[alias], previous = graph.accounts[id]; own(previous);
    const serviceId = reference('services', raw.service);
    const service = services[serviceId];
    if (!service || (service.ownerId !== ownerId && service.ownerId !== options.hostOwnerId)) throw new ProviderError('forbidden');
    const auth = record(raw.auth); keys(auth, ['method', 'source']);
    const authentication = { method: text(auth.method), ...(auth.source !== undefined ? { source: text(auth.source) } : {}) } as ProviderAccount['authentication'];
    if (previous && (previous.serviceId !== serviceId || canonical(previous.authentication) !== canonical(authentication))) {
      // Replacement is an explicit remove/new identity and reviewed rebind, never an update by name.
      throw new ProviderError('plan-conflict');
    }
    accounts[id] = retainRevision(previous, { id, rootId: graph.rootId, ownerId, revision: (previous?.revision ?? 0) + 1,
      ...label(raw.label, previous, alias), serviceId,
      incarnation: previous?.incarnation ?? text(options.createId('incarnation')), authentication });
    if (accounts[id] !== previous) changes.accounts[previous ? 'updated' : 'created'].push(id);
  }
  for (const [alias, value] of Object.entries(sourceProfiles)) {
    const raw = record(value); keys(raw, ['account', 'model', 'parameters', 'label']);
    const id = maps.profiles[alias], previous = graph.profiles[id]; own(previous);
    const accountId = reference('accounts', raw.account);
    if (accounts[accountId]?.ownerId !== ownerId) throw new ProviderError('forbidden');
    const model = text(raw.model);
    const candidate = { id, rootId: graph.rootId, ownerId, revision: (previous?.revision ?? 0) + 1,
      ...label(raw.label, previous, alias), accountId, model, parameters: json(raw.parameters) };
    const normalized = await options.validateProfile?.({ service: services[accounts[accountId].serviceId], account: accounts[accountId], profile: candidate });
    profiles[id] = retainRevision(previous, { ...candidate, ...(normalized !== undefined ? { parameters: json(normalized) } : {}) });
    if (profiles[id] !== previous) changes.profiles[previous ? 'updated' : 'created'].push(id);
  }
  let purposes: PurposePolicy = graph.purposes;
  if (input.purposes !== undefined) {
    if (!isHost) throw new ProviderError('forbidden');
    const raw = record(input.purposes); keys(raw, ['chat', 'summary', 'ambient', 'perception', 'image', 'decisions', 'agents', 'adapters', 'endpoints', 'scenes']);
    const profileReference = (entry: unknown): string => {
      const value = record(entry); keys(value, ['profile']); return reference('profiles', value.profile);
    };
    const selection = (entry: unknown, scene = false): Record<string, unknown> => {
      const value = record(entry); keys(value, scene ? ['chat'] : ['chat', 'perception']);
      return { ...(value.chat !== undefined && value.chat !== null ? { chat: profileReference(value.chat) } : {}),
        ...(value.perception !== undefined && value.perception !== null ? { perception: perception(value.perception) } : {}) };
    };
    const perception = (entry: unknown): Record<string, unknown> => {
      const value = record(entry); keys(value, ['profile', 'fallbacks']);
      if (value.fallbacks !== undefined && !Array.isArray(value.fallbacks)) return invalid();
      return { profile: reference('profiles', value.profile), ...(value.fallbacks !== undefined
        ? { fallbacks: (value.fallbacks as unknown[]).map(alias => reference('profiles', alias)) } : {}) };
    };
    const mergeValues = (previous: unknown, input: unknown, transform: (value: unknown) => unknown): Record<string, unknown> => {
      const result = Object.assign(Object.create(null), previous) as Record<string, unknown>;
      for (const [key, value] of Object.entries(record(input))) {
        if (value === null) delete result[key];
        else result[key] = transform(value);
      }
      return result;
    };
    purposes = { ...purposes, defaults: { ...purposes.defaults,
      ...(raw.chat !== undefined ? { chat: raw.chat === null ? undefined : profileReference(raw.chat) } : {}),
      ...(raw.ambient !== undefined ? { ambient: raw.ambient === null ? undefined : profileReference(raw.ambient) } : {}),
      ...(raw.summary !== undefined ? { summary: raw.summary === null ? undefined : profileReference(raw.summary) } : {}),
      ...(raw.image !== undefined ? { image: raw.image === null ? undefined : profileReference(raw.image) } : {}),
      ...(raw.perception !== undefined ? { perception: raw.perception === null ? undefined : perception(raw.perception) as unknown as PurposePolicy['defaults']['perception'] } : {}) },
    ...(raw.decisions !== undefined ? { decisions: mergeValues(purposes.decisions, raw.decisions, entry => {
        const value = record(entry);
        return { ...value, ...(value.profile !== undefined ? { profile: reference('profiles', value.profile) } : {}) };
      }) } : {}),
    ...(raw.agents !== undefined ? { agents: mergeValues(purposes.agents, raw.agents, profileReference) as Record<string, string> } : {}),
    ...(raw.adapters !== undefined ? { adapters: mergeValues(purposes.adapters, raw.adapters, value => selection(value)) } : {}),
    ...(raw.endpoints !== undefined ? { endpoints: mergeValues(purposes.endpoints, raw.endpoints, value => selection(value)) } : {}),
    ...(raw.scenes !== undefined ? { scenes: mergeValues(purposes.scenes, raw.scenes, value => selection(value, true)) } : {}),
    } as PurposePolicy;
  }
  const remove = dictionary(input.remove); keys(remove, ['services', 'accounts', 'profiles']);
  for (const kind of ['profiles', 'accounts', 'services'] as const) {
    if (remove[kind] === undefined) continue;
    if (!Array.isArray(remove[kind])) return invalid();
    for (const id of remove[kind] as unknown[]) {
      const target = text(id), collection = { services, accounts, profiles }[kind];
      if (!Object.hasOwn(collection, target)) throw new ProviderError('plan-conflict');
      own(collection[target]); delete collection[target]; changes[kind].removed.push(target);
    }
  }
  const explicitProfiles = new Set(Object.keys(sourceProfiles).map(alias => maps.profiles[alias]));
  const candidates = new Set<string>();
  const changedServices = new Set(changes.services.updated.filter(id => canonical({ ...graph.services[id], label: undefined, revision: 0 }) !== canonical({ ...services[id], label: undefined, revision: 0 })));
  for (const profile of Object.values(profiles)) if (changedServices.has(accounts[profile.accountId]?.serviceId)) candidates.add(profile.id);
  for (const id of changedPurposeProfileIds(graph.purposes, purposes)) if (profiles[id]) candidates.add(id);
  if (options.validateProfile) for (const id of candidates) {
    const profile = profiles[id];
    if (!profile || explicitProfiles.has(id)) continue;
    const account = accounts[profile.accountId];
    if (!account || !services[account.serviceId]) continue; // Final graph normalization diagnoses removed references.
    const parameters = json(await options.validateProfile({ service: services[account.serviceId], account, profile }));
    // Shared Service edits validate dependencies without acquiring another owner's Profile write authority.
    if (profile.ownerId !== ownerId) continue;
    const normalized = retainRevision(profile, { ...profile, revision: profile.revision + 1, parameters });
    if (normalized !== profile) { profiles[id] = normalized; changes.profiles.updated.push(id); }
  }
  const next = normalizeProviderGraph({ rootId: graph.rootId, revision: graph.revision + 1, services, accounts, profiles, purposes });
  // Policy is deployment-owned even if every selected private resource is internally valid.
  const scopedHostProfiles = [...Object.values(next.purposes.adapters ?? {}), ...Object.values(next.purposes.endpoints ?? {})]
    .flatMap(policy => [policy.chat, policy.perception?.profile, ...(policy.perception?.fallbacks ?? [])]);
  const hostProfiles = [next.purposes.defaults.chat, next.purposes.defaults.summary, next.purposes.defaults.ambient, next.purposes.defaults.image,
    next.purposes.defaults.perception?.profile, ...(next.purposes.defaults.perception?.fallbacks ?? []),
    ...Object.values(next.purposes.decisions ?? {}).map(policy => policy.profile), ...Object.values(next.purposes.agents ?? {}),
    ...scopedHostProfiles, ...Object.values(next.purposes.scenes ?? {}).map(policy => policy.chat)];
  if (hostProfiles.some(id => id !== undefined && next.profiles[id].ownerId !== options.hostOwnerId)) throw new ProviderError('forbidden');
  const frozenBindings = Object.freeze({ services: Object.freeze({ ...maps.services }), accounts: Object.freeze({ ...maps.accounts }), profiles: Object.freeze({ ...maps.profiles }) });
  return Object.freeze({ rootId: graph.rootId, ownerId, baseRevision: graph.revision,
    fingerprint: providerPlanFingerprint({ input, bindings: frozenBindings, graph: next, baseRevision: graph.revision, ownerId }),
    graph: next, bindings: frozenBindings,
    changes: Object.freeze(Object.fromEntries(Object.entries(changes).map(([kind, change]) => [kind,
      Object.freeze({ created: Object.freeze(change.created), updated: Object.freeze(change.updated), removed: Object.freeze(change.removed) })]))) as ReviewedProviderPlan['changes'],
  });
}

/** Typed reference paths: arbitrary strings in decision parameters are never Profile references. */
export function changedPurposeProfileIds(before: PurposePolicy, after: PurposePolicy): readonly string[] {
  const collect = (policy: PurposePolicy): Map<string, string> => {
    const refs = new Map<string, string>();
    const put = (path: readonly (string | number)[], id: string | undefined) => {
      if (id) refs.set(JSON.stringify(path), id);
    };
    const perception = (path: readonly string[], value: PurposePolicy['defaults']['perception']) => {
      put([...path, 'profile'], value?.profile);
      value?.fallbacks?.forEach((id, index) => put([...path, 'fallbacks', index], id));
    };
    for (const key of ['chat', 'summary', 'ambient', 'image'] as const) put(['defaults', key], policy.defaults[key]);
    perception(['defaults', 'perception'], policy.defaults.perception);
    for (const [name, id] of Object.entries(policy.agents ?? {})) put(['agents', name], id);
    for (const [task, value] of Object.entries(policy.decisions ?? {})) put(['decisions', task], value.profile);
    for (const kind of ['adapters', 'endpoints'] as const) for (const [key, value] of Object.entries(policy[kind] ?? {})) {
      put([kind, key, 'chat'], value.chat);
      perception([kind, key, 'perception'], value.perception);
    }
    for (const [key, value] of Object.entries(policy.scenes ?? {})) put(['scenes', key, 'chat'], value.chat);
    return refs;
  };
  const old = collect(before);
  return [...new Set([...collect(after)].filter(([path, id]) => old.get(path) !== id).map(([, id]) => id))];
}
