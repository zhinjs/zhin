import { adapterFeatureId, isAdapterIndex, type AdapterIndex } from '@zhin.js/adapter';
import type { OperationSession } from '@zhin.js/feature-kit';
import { isDeepStrictEqual } from 'node:util';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { childPluginId, rootPluginId, readPluginConfigurationMap, type CapabilityId, type ConfigDocumentPort, type RuntimeConfigDocument, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { expandEnvironmentValue, type RootPluginConfigurationSelection } from '@zhin.js/runtime';

export interface EndpointRoleResolver {
  resolveOwner(pluginKey: string, endpointId: string): string | undefined;
  resolveTrusted(pluginKey: string, endpointId: string): readonly string[];
}
interface Roles { readonly master?: string; readonly trusted: readonly string[] }
interface PluginRoles { readonly base: Roles; readonly endpoints: Map<string, Roles | undefined> }

export type ConfigurationChatAuthorizer = (session: OperationSession<string>, adapters: AdapterIndex) => boolean;

/** Startup role authority, matched against the actual operation's Adapter and account.
 * Only the `master` of the endpoint that received this private message (leaf, else its
 * Plugin-level `master`) qualifies, so identity stays on the same platform/account.
 * `ai.trigger.masters` has no platform dimension and is deliberately not accepted in v1.
 * Direct declared owners are mapped with the canonical PluginId constructor. Nested
 * owners never borrow their parent's role configuration or a legacy display alias.
 */
export function createConfigurationChatAuthorizer(
  startup: RuntimeConfigDocument, endpointRoles: EndpointRoleResolver,
): ConfigurationChatAuthorizer {
  const owners = new Map(Object.keys(readPluginConfigurationMap(startup)).map(key => [childPluginId(rootPluginId(), key), key]));
  return (session, adapters) => {
    if (session.scene.kind !== 'private' || !session.sender?.id || !isAdapterIndex(adapters)) return false;
    const id = session.scene.endpoint.id as CapabilityId;
    const adapter = adapters.adapterForEndpoint(id);
    const child = adapter?.find(id);
    if (!adapter || !child || session.adapter !== adapter || session.endpoint !== adapter.getEndpoint(child.desired.instanceId)) return false;
    if (!child.started || session.signal.aborted) return false;
    const key = owners.get(adapter.descriptor.owner);
    return key !== undefined && endpointRoles.resolveOwner(key, child.desired.endpointId) === session.sender.id;
  };
}

/** Resolve account roles inside their declaring Plugin. Legacy aliases are accepted only when unique. */
export async function createEndpointRoleResolver(config: RuntimeConfigDocument | ConfigDocumentPort): Promise<EndpointRoleResolver> {
  const document = await readConfigDocumentValue(config);
  if (!document || typeof document !== 'object') return { resolveOwner: () => undefined, resolveTrusted: () => [] };
  const plugins = expandEnvironmentValue(readPluginConfigurationMap(document as Record<string, unknown>), key => process.env[key]) as Record<string, unknown>;
  return compileEndpointRoles(plugins).resolver;
}

function compileEndpointRoles(plugins: Readonly<Record<string, unknown>>) {
  const scopes = new Map<string, PluginRoles>();
  const aliases = new Map<string, PluginRoles | undefined>();
  const lookupKeys = new Map<string, Set<string>>();
  const contributors = new Map<string, Set<string>>();
  const endpointKeys = new Set<string>();
  const contribute = (key: string, pluginKey: string) => {
    const owners = contributors.get(key) ?? new Set<string>();
    owners.add(pluginKey); contributors.set(key, owners);
  };
  const alias = (key: string | undefined, scope: PluginRoles, pluginKey: string) => {
    if (!key) return;
    lookupKeys.get(pluginKey)!.add(key); contribute(key, pluginKey);
    if (!aliases.has(key)) aliases.set(key, scope);
    else if (aliases.get(key) !== scope) aliases.set(key, undefined);
  };
  for (const [pluginKey, value] of Object.entries(plugins)) {
    if (!isRecord(value)) continue;
    const scope: PluginRoles = { base: roles(value), endpoints: new Map() };
    scopes.set(pluginKey, scope);
    lookupKeys.set(pluginKey, new Set([pluginKey])); contribute(pluginKey, pluginKey);
    const entries = Array.isArray(value.endpoints) ? value.endpoints.filter(isRecord) : [];
    for (const entry of entries) {
      const leaf = roles(entry);
      for (const key of new Set([identity(entry.id), identity(entry.name)])) {
        if (!key) continue;
        endpointKeys.add(key);
        if (!scope.endpoints.has(key)) scope.endpoints.set(key, leaf);
        else scope.endpoints.set(key, undefined);
      }
    }
    // Preserve old single-account aliases; never merge aliases belonging to different Plugins.
    if (entries.length <= 1) {
      alias(identity(value.name), scope, pluginKey);
      if (entries.length === 1) {
        alias(identity(entries[0]!.id), scope, pluginKey);
        alias(identity(entries[0]!.name), scope, pluginKey);
      }
    }
  }
  const lookup = (pluginKey: string, endpointId: string) => {
    const scope = scopes.get(pluginKey) ?? aliases.get(pluginKey);
    if (!scope) return undefined;
    if (scope.endpoints.has(endpointId) && !scope.endpoints.get(endpointId)) return undefined;
    return { base: scope.base, leaf: scope.endpoints.get(endpointId) };
  };
  const resolver: EndpointRoleResolver = {
    resolveOwner(pluginKey, endpointId) {
      const found = lookup(pluginKey, endpointId);
      return found?.leaf?.master ?? found?.base.master;
    },
    resolveTrusted(pluginKey, endpointId) {
      const found = lookup(pluginKey, endpointId);
      return found ? [...new Set([...found.base.trusted, ...(found.leaf?.trusted ?? [])])] : [];
    },
  };
  return { resolver, lookupKeys, contributors, endpointKeys };
}

/** Startup role consumers are process-owned. Keep their configuration honest
 * until restart instead of claiming a new role map which they cannot consume.
 */
export function createEndpointRoleConfigurationSelection(
  startup: RuntimeConfigDocument,
  resolver: EndpointRoleResolver,
): RootPluginConfigurationSelection {
  const initial = compileEndpointRoles(readPluginConfigurationMap(startup));
  return { select(input) {
    const previous = compileEndpointRoles(input.expand(readPluginConfigurationMap(input.previous)));
    const next = compileEndpointRoles(input.expand(readPluginConfigurationMap(input.next)));
    const endpoints = new Set([...initial.endpointKeys, ...previous.endpointKeys, ...next.endpointKeys]);
    // Endpoint identities not declared in YAML still inherit base roles. One
    // absent identity proves that fallback without depending on array position.
    let fallback = '__zhin_role_fallback__';
    while (endpoints.has(fallback)) fallback += '_';
    endpoints.add(fallback);
    const disabled = new Set(Array.isArray(input.next.disable_plugins) ? input.next.disable_plugins : []);
    const selected = new Set<string>();
    for (const [owner, keys] of next.lookupKeys) {
      // Disabled accounts still retain their old role configuration so a later
      // enable cannot adopt an unconsumed role change. Their legacy aliases do
      // not need to keep removed accounts alive while there is no consumer.
      for (const key of disabled.has(owner) ? [owner] : keys) {
        const differs = [...endpoints].some(endpoint => !isDeepStrictEqual(
          roleMembership(resolver, key, endpoint), roleMembership(next.resolver, key, endpoint)));
        if (!differs) continue;
        selected.add(owner);
        // A legacy alias can become unique when a different owner disappears.
        // Retain all contributing declarations, including a removed owner, so
        // the effective document describes the process's actual ambiguity.
        for (const state of [initial, previous, next]) for (const contributor of state.contributors.get(key) ?? []) selected.add(contributor);
      }
    }
    return [...selected].map(instanceKey => ({ instanceKey, reasonCode: 'endpoint-roles-process-owned' }));
  } };
}

function roleMembership(resolver: EndpointRoleResolver, owner: string, endpoint: string) {
  return { master: resolver.resolveOwner(owner, endpoint), trusted: [...new Set(resolver.resolveTrusted(owner, endpoint))].sort() };
}

/** Identity comes from the captured Adapter owner and child desired state, never user payload. */
export function resolveEndpointRoleTarget(conversation: ConversationRef, snapshot?: RuntimeSnapshot, trustedEndpointId?: string): Readonly<{ pluginKey: string; endpointId: string }> | undefined {
  const adapters = snapshot?.projections.get(adapterFeatureId);
  if (isAdapterIndex(adapters)) {
    const adapter = adapters.adapterForEndpoint(conversation.endpoint.id as CapabilityId);
    const child = adapter?.find(conversation.endpoint.id as CapabilityId);
    const owner = adapter && snapshot?.tree.get(adapter.descriptor.owner);
    if (!owner || !child) return undefined;
    return { pluginKey: owner.instanceKey, endpointId: child.desired.endpointId };
  }
  // Legacy synthetic callers may provide the framework's explicit endpoint identity.
  // A real captured projection which cannot resolve the account must never take this path.
  if (trustedEndpointId && conversation.endpoint.adapter) return { pluginKey: conversation.endpoint.adapter, endpointId: trustedEndpointId };
  return undefined;
}

export async function createSenderEnricher(config: RuntimeConfigDocument | ConfigDocumentPort, endpointRoles: EndpointRoleResolver): Promise<NonNullable<ConstructorParameters<typeof ImRuntime>[0]>['enrichSender']> {
  const document = await readConfigDocumentValue(config);
  const ai = isRecord(document) && isRecord(document.ai) ? document.ai : undefined;
  const trigger = ai && isRecord(ai.trigger) ? ai.trigger : undefined;
  const globalMasters = normalizeTrustedIdList(trigger?.masters);
  const globalTrusted = normalizeTrustedIdList(trigger?.trusted);
  return (sender, conversation, snapshot) => {
    if (!sender?.id) return sender;
    const target = resolveEndpointRoleTarget(conversation, snapshot);
    const master = target && endpointRoles.resolveOwner(target.pluginKey, target.endpointId);
    const trusted = target ? endpointRoles.resolveTrusted(target.pluginKey, target.endpointId) : [];
    const isMaster = globalMasters.includes(sender.id) || sender.id === master;
    const isTrusted = !isMaster && (globalTrusted.includes(sender.id) || trusted.includes(sender.id));
    if (!isMaster && !isTrusted) return sender;
    const role = isMaster ? 'master' : 'trusted';
    const existing = sender.roles ?? [];
    return existing.includes(role) ? sender : { ...sender, roles: [role, ...existing] };
  };
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identity(value: unknown): string | undefined { return value != null && String(value).trim() ? String(value) : undefined; }
function roles(value: Record<string, unknown>): Roles { return { master: identity(value.master), trusted: normalizeTrustedIdList(value.trusted) }; }
function normalizeTrustedIdList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(value => String(value).trim()).filter(Boolean);
  return typeof input === 'string' ? input.split(/[\s,]+/).map(value => value.trim()).filter(Boolean) : [];
}
async function readConfigDocumentValue(config: RuntimeConfigDocument | ConfigDocumentPort): Promise<unknown> {
  if (!config || typeof config !== 'object') return config;
  const candidate = config as Partial<ConfigDocumentPort>;
  if (typeof candidate.read !== 'function') return config;
  const snapshot = await candidate.read();
  return snapshot && typeof snapshot === 'object' && 'document' in snapshot ? snapshot.document : snapshot;
}
