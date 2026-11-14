import type { JsonValue } from '../decision/types.js';
import {
  ProviderError, type ProviderGraph, type ProviderResource, type ProviderService,
  type ProviderAccount, type ModelProfile, type ModelDefinition, type JsonObject,
  type ModelKind, type PurposePolicy, type ScopedModelSelection, type PerceptionSelection,
  type DecisionPurposePolicy, type DecisionPurpose,
} from './types.js';

export const MODEL_KINDS = ['language', 'decision', 'image'] as const;
export const DECISION_PURPOSES = ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'] as const;
const MODALITIES = ['text', 'image', 'audio', 'video', 'file'] as const;
function invalid(): never { throw new ProviderError('invalid-graph'); }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return invalid();
  return input as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) invalid();
}
function text(input: unknown): string {
  if (typeof input !== 'string' || !input || input !== input.trim()) return invalid();
  return input;
}
function integer(input: unknown, minimum = 1): number {
  if (!Number.isSafeInteger(input) || Number(input) < minimum) return invalid();
  return Number(input);
}
function optional<T>(value: unknown, parse: (input: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}
function dictionary<T>(input: unknown, parse: (input: unknown, key: string) => T): Readonly<Record<string, T>> {
  const raw = object(input);
  if (Reflect.ownKeys(raw).some(key => typeof key !== 'string')) return invalid();
  const result: Record<string, T> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) result[text(key)] = parse(value, key);
  return Object.freeze(result);
}
/** Detached JSON values; reject cycles, capabilities and non-finite numbers. */
export function normalizeProviderJson(input: unknown): JsonValue {
  const ancestors = new Set<object>();
  function visit(value: unknown): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : invalid();
    if (!value || typeof value !== 'object' || ancestors.has(value)) return invalid();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return Object.freeze(Array.from(value, visit));
      return dictionary(value, item => visit(item));
    } finally { ancestors.delete(value); }
  }
  return visit(input);
}
function jsonObject(input: unknown): JsonObject {
  object(input);
  return normalizeProviderJson(input) as JsonObject;
}
function resource(value: Record<string, unknown>, key: string, rootId: string): ProviderResource {
  const id = text(value.id);
  if (id !== key || value.rootId !== rootId) return invalid();
  return { id, rootId, ownerId: text(value.ownerId), revision: integer(value.revision),
    ...(value.label !== undefined ? { label: text(value.label) } : {}) };
}
const RESOURCE_FIELDS = ['id', 'rootId', 'ownerId', 'revision', 'label'];
function model(input: unknown, key: string): ModelDefinition {
  const raw = object(input);
  fields(raw, ['id', 'kinds', 'protocol', 'input', 'streaming', 'toolCalling', 'thinking', 'contextWindow', 'maxOutputTokens']);
  if (raw.id !== key || !Array.isArray(raw.kinds) || raw.kinds.length === 0
    || Array.from(raw.kinds).some(kind => !MODEL_KINDS.includes(kind))) return invalid();
  const kinds = Object.freeze([...new Set(raw.kinds)]) as readonly ModelKind[];
  const result: Record<string, unknown> = { id: text(raw.id), kinds, protocol: text(raw.protocol) };
  if (raw.input !== undefined) {
    if (!Array.isArray(raw.input) || Array.from(raw.input).some(item => !MODALITIES.includes(item))) return invalid();
    result.input = Object.freeze([...new Set(raw.input)]);
  }
  for (const key of ['streaming', 'toolCalling', 'thinking'] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') return invalid();
      result[key] = raw[key];
    }
  }
  for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
    if (raw[key] !== undefined) result[key] = integer(raw[key]);
  }
  return Object.freeze(result) as unknown as ModelDefinition;
}
function service(input: unknown, key: string, rootId: string): ProviderService {
  const raw = object(input);
  fields(raw, [...RESOURCE_FIELDS, 'driver', 'options', 'models']);
  const driver = object(raw.driver);
  fields(driver, ['id', 'owner', 'contractVersion']);
  return Object.freeze({ ...resource(raw, key, rootId),
    driver: Object.freeze({ id: text(driver.id), owner: text(driver.owner), contractVersion: text(driver.contractVersion) }),
    options: jsonObject(raw.options), models: dictionary(raw.models, model) });
}
function account(input: unknown, key: string, rootId: string): ProviderAccount {
  const raw = object(input);
  fields(raw, [...RESOURCE_FIELDS, 'serviceId', 'incarnation', 'authentication']);
  const auth = object(raw.authentication);
  fields(auth, ['method', 'source']);
  if (!['none', 'api-key', 'oauth'].includes(String(auth.method))) return invalid();
  const source = optional(auth.source, text);
  if (source !== undefined && (auth.method !== 'api-key' || !/^env:\/\/[A-Za-z_][A-Za-z0-9_]*$/u.test(source))) return invalid();
  return Object.freeze({ ...resource(raw, key, rootId), serviceId: text(raw.serviceId), incarnation: text(raw.incarnation),
    authentication: Object.freeze({ method: auth.method, ...(source !== undefined ? { source } : {}) }) as ProviderAccount['authentication'] });
}
function profile(input: unknown, key: string, rootId: string): ModelProfile {
  const raw = object(input);
  fields(raw, [...RESOURCE_FIELDS, 'accountId', 'model', 'parameters']);
  return Object.freeze({ ...resource(raw, key, rootId), accountId: text(raw.accountId), model: text(raw.model), parameters: jsonObject(raw.parameters) });
}
function perception(input: unknown): PerceptionSelection {
  const raw = object(input);
  fields(raw, ['profile', 'fallbacks']);
  if (raw.fallbacks !== undefined && !Array.isArray(raw.fallbacks)) return invalid();
  return Object.freeze({ profile: text(raw.profile), ...(raw.fallbacks !== undefined
    ? { fallbacks: Object.freeze((raw.fallbacks as unknown[]).map(text)) } : {}) });
}
/** Reject one value, naming its path in import-plan notation (#1250). */
function invalidAt(path: string): never { throw new ProviderError('invalid-graph', path); }
/**
 * An ordered fallback chain of a language purpose (#1250 chat-purpose-no-fallback):
 * non-empty, without duplicates, never naming its own primary, and only next to a primary.
 */
function fallbackChain(input: unknown, primary: string | undefined, path: string): readonly string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || primary === undefined || input.length === 0) return invalidAt(path);
  const ids = input.map((id, index) => typeof id === 'string' && id && id === id.trim() ? id : invalidAt(`${path}[${index}]`));
  ids.forEach((id, index) => { if (id === primary || ids.indexOf(id) !== index) invalidAt(`${path}[${index}]`); });
  return Object.freeze(ids);
}
function withFallbacks(raw: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const primary = raw[key] !== undefined ? text(raw[key]) : undefined;
  const fallbacks = fallbackChain(raw[`${key}Fallbacks`], primary, `${path}.${key}.fallbacks`);
  return { ...(primary !== undefined ? { [key]: primary } : {}), ...(fallbacks ? { [`${key}Fallbacks`]: fallbacks } : {}) };
}
function scoped(input: unknown, defaults = false, path = 'purposes'): ScopedModelSelection & { summary?: string; image?: string; ambient?: string } {
  const raw = object(input);
  fields(raw, defaults
    ? ['chat', 'chatFallbacks', 'perception', 'summary', 'summaryFallbacks', 'image', 'ambient', 'ambientFallbacks']
    : ['chat', 'chatFallbacks', 'perception']);
  return Object.freeze({ ...withFallbacks(raw, 'chat', path),
    ...(raw.perception !== undefined ? { perception: perception(raw.perception) } : {}),
    ...(defaults ? withFallbacks(raw, 'summary', path) : {}),
    ...(defaults ? withFallbacks(raw, 'ambient', path) : {}), ...(raw.image !== undefined ? { image: text(raw.image) } : {}) });
}
function decision(input: unknown): DecisionPurposePolicy {
  const raw = object(input);
  fields(raw, ['profile', 'mode', 'timeoutMs', 'minConfidence', 'topK', 'maxCandidates', 'maxSelections']);
  if (!['off', 'shadow', 'active'].includes(String(raw.mode))) return invalid();
  const result: Record<string, unknown> = { mode: raw.mode };
  if (raw.profile !== undefined) result.profile = text(raw.profile);
  if (raw.mode !== 'off' && result.profile === undefined) return invalid();
  for (const key of ['timeoutMs', 'topK', 'maxCandidates', 'maxSelections']) {
    if (raw[key] !== undefined) result[key] = integer(raw[key]);
  }
  if (raw.timeoutMs !== undefined && Number(raw.timeoutMs) > 2_147_483_647) return invalid();
  if (raw.minConfidence !== undefined) {
    if (typeof raw.minConfidence !== 'number' || !Number.isFinite(raw.minConfidence) || raw.minConfidence < 0 || raw.minConfidence > 1) return invalid();
    result.minConfidence = raw.minConfidence;
  }
  return Object.freeze(result) as unknown as DecisionPurposePolicy;
}
function purposes(input: unknown): PurposePolicy {
  const raw = object(input);
  fields(raw, ['defaults', 'decisions', 'agents', 'agentFallbacks', 'adapters', 'endpoints', 'scenes']);
  const result: PurposePolicy = { defaults: scoped(raw.defaults, true),
    ...(raw.agents !== undefined ? { agents: dictionary(raw.agents, text) } : {}),
    ...(raw.agentFallbacks !== undefined ? { agentFallbacks: dictionary(raw.agentFallbacks, (chain, key) => {
      const agents = raw.agents === undefined ? undefined : object(raw.agents);
      return fallbackChain(chain, agents && Object.hasOwn(agents, key) ? text(agents[key]) : undefined, `purposes.agents.${key}.fallbacks`)!;
    }) } : {}),
    ...(raw.adapters !== undefined ? { adapters: dictionary(raw.adapters, (entry, key) => scoped(entry, false, `purposes.adapters.${key}`)) } : {}),
    ...(raw.endpoints !== undefined ? { endpoints: dictionary(raw.endpoints, (entry, key) => scoped(entry, false, `purposes.endpoints.${key}`)) } : {}),
    ...(raw.scenes !== undefined ? { scenes: dictionary(raw.scenes, (input, key) => {
      const value = object(input); fields(value, ['chat', 'chatFallbacks']);
      return Object.freeze(withFallbacks(value, 'chat', `purposes.scenes.${key}`));
    }) } : {}),
    ...(raw.decisions !== undefined ? { decisions: dictionary(raw.decisions, (entry, key) => {
      if (!DECISION_PURPOSES.includes(key as DecisionPurpose)) return invalid();
      return decision(entry);
    }) } : {}) };
  return Object.freeze(result);
}
/** Validate and detach a complete public graph; no credentials, I/O or discovery. */
export function normalizeProviderGraph(input: unknown): ProviderGraph {
  const raw = object(input);
  fields(raw, ['rootId', 'revision', 'services', 'accounts', 'profiles', 'purposes']);
  const rootId = text(raw.rootId);
  const graph: ProviderGraph = Object.freeze({ rootId, revision: integer(raw.revision, 0),
    services: dictionary(raw.services, (value, key) => service(value, key, rootId)),
    accounts: dictionary(raw.accounts, (value, key) => account(value, key, rootId)),
    profiles: dictionary(raw.profiles, (value, key) => profile(value, key, rootId)), purposes: purposes(raw.purposes) });
  for (const account of Object.values(graph.accounts)) if (!Object.hasOwn(graph.services, account.serviceId)) return invalid();
  for (const profile of Object.values(graph.profiles)) {
    const account = graph.accounts[profile.accountId];
    if (!account || account.ownerId !== profile.ownerId
      || !Object.hasOwn(graph.services[account.serviceId].models, profile.model)) return invalid();
  }
  // Purpose references name their path: a removed Profile still referenced by a chain is reported there.
  const check = (id: string | undefined, kind: ModelKind, path: string): void => {
    if (id === undefined) return;
    const profile = graph.profiles[id];
    const account = profile && graph.accounts[profile.accountId];
    if (!profile || !account || !graph.services[account.serviceId].models[profile.model].kinds.includes(kind)) invalidAt(path);
  };
  const chain = (ids: readonly string[] | undefined, path: string) => ids?.forEach((id, index) => check(id, 'language', `${path}[${index}]`));
  const checkScoped = (entry: ScopedModelSelection, path: string): void => {
    check(entry.chat, 'language', `${path}.chat`);
    chain(entry.chatFallbacks, `${path}.chat.fallbacks`);
    check(entry.perception?.profile, 'language', `${path}.perception.profile`);
    chain(entry.perception?.fallbacks, `${path}.perception.fallbacks`);
  };
  const defaults = graph.purposes.defaults;
  checkScoped(defaults, 'purposes');
  check(defaults.summary, 'language', 'purposes.summary'); chain(defaults.summaryFallbacks, 'purposes.summary.fallbacks');
  check(defaults.ambient, 'language', 'purposes.ambient'); chain(defaults.ambientFallbacks, 'purposes.ambient.fallbacks');
  check(defaults.image, 'image', 'purposes.image');
  for (const [key, entry] of Object.entries(graph.purposes.adapters ?? {})) checkScoped(entry, `purposes.adapters.${key}`);
  for (const [key, entry] of Object.entries(graph.purposes.endpoints ?? {})) checkScoped(entry, `purposes.endpoints.${key}`);
  for (const [key, entry] of Object.entries(graph.purposes.scenes ?? {})) {
    check(entry.chat, 'language', `purposes.scenes.${key}.chat`);
    chain(entry.chatFallbacks, `purposes.scenes.${key}.chat.fallbacks`);
  }
  for (const [key, id] of Object.entries(graph.purposes.agents ?? {})) check(id, 'language', `purposes.agents.${key}`);
  for (const [key, ids] of Object.entries(graph.purposes.agentFallbacks ?? {})) chain(ids, `purposes.agents.${key}.fallbacks`);
  for (const [task, entry] of Object.entries(graph.purposes.decisions ?? {})) check(entry.profile, 'decision', `purposes.decisions.${task}.profile`);
  return graph;
}

export function createEmptyProviderGraph(rootId: string): ProviderGraph {
  return normalizeProviderGraph({ rootId, revision: 0, services: {}, accounts: {}, profiles: {}, purposes: { defaults: {} } });
}
