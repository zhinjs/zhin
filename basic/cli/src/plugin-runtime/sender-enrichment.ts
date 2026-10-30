import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { readPluginConfigurationMap, type CapabilityId, type ConfigDocumentPort, type RuntimeConfigDocument, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { expandEnvironmentValue } from '@zhin.js/runtime';

export interface EndpointRoleResolver {
  resolveOwner(pluginKey: string, endpointId: string): string | undefined;
  resolveTrusted(pluginKey: string, endpointId: string): readonly string[];
}
interface Roles { readonly master?: string; readonly trusted: readonly string[] }
interface PluginRoles { readonly base: Roles; readonly endpoints: Map<string, Roles | undefined> }

/** Resolve account roles inside their declaring Plugin. Legacy aliases are accepted only when unique. */
export async function createEndpointRoleResolver(config: RuntimeConfigDocument | ConfigDocumentPort): Promise<EndpointRoleResolver> {
  const document = await readConfigDocumentValue(config);
  if (!document || typeof document !== 'object') return { resolveOwner: () => undefined, resolveTrusted: () => [] };
  const plugins = expandEnvironmentValue(readPluginConfigurationMap(document as Record<string, unknown>), key => process.env[key]) as Record<string, unknown>;
  const scopes = new Map<string, PluginRoles>();
  const aliases = new Map<string, PluginRoles | undefined>();
  const alias = (key: string | undefined, scope: PluginRoles) => {
    if (!key) return;
    if (!aliases.has(key)) aliases.set(key, scope);
    else if (aliases.get(key) !== scope) aliases.set(key, undefined);
  };
  for (const [pluginKey, value] of Object.entries(plugins)) {
    if (!isRecord(value)) continue;
    const scope: PluginRoles = { base: roles(value), endpoints: new Map() };
    scopes.set(pluginKey, scope);
    const entries = Array.isArray(value.endpoints) ? value.endpoints.filter(isRecord) : [];
    for (const entry of entries) {
      const leaf = roles(entry);
      for (const key of new Set([identity(entry.id), identity(entry.name)])) {
        if (!key) continue;
        if (!scope.endpoints.has(key)) scope.endpoints.set(key, leaf);
        else scope.endpoints.set(key, undefined);
      }
    }
    // Preserve old single-account aliases; never merge aliases belonging to different Plugins.
    if (entries.length <= 1) {
      alias(identity(value.name), scope);
      if (entries.length === 1) {
        alias(identity(entries[0]!.id), scope);
        alias(identity(entries[0]!.name), scope);
      }
    }
  }
  const lookup = (pluginKey: string, endpointId: string) => {
    const scope = scopes.get(pluginKey) ?? aliases.get(pluginKey);
    if (!scope) return undefined;
    if (scope.endpoints.has(endpointId) && !scope.endpoints.get(endpointId)) return undefined;
    return { base: scope.base, leaf: scope.endpoints.get(endpointId) };
  };
  return {
    resolveOwner(pluginKey, endpointId) {
      const found = lookup(pluginKey, endpointId);
      return found?.leaf?.master ?? found?.base.master;
    },
    resolveTrusted(pluginKey, endpointId) {
      const found = lookup(pluginKey, endpointId);
      return found ? [...new Set([...found.base.trusted, ...(found.leaf?.trusted ?? [])])] : [];
    },
  };
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
