/**
 * ADR 0055 / 0056: conversation-level feature overrides and chat roles for the instance.
 * Defines the instance-owned tables, loads them once the DatabaseHost started, provides the
 * conversation read side to the Runtime (dispatch gates, `configFor` / `isEnabledFor`) and
 * installs the in-chat `feature` / `role` commands when `features.selfService.enabled` is true.
 */
import type { EndpointRoleResolver } from '@zhin.js/core/runtime';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import {
  decodeStorageIdentity, featureConversationOverridesToken, resolveEndpointFeatureKey,
  type DatabaseHost, type RuntimeConfigDocument, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  ChatRoleService, ChatRoleStore, createConfigChatRoleSource, createPlatformChatRoleSource, defineChatRoleTable,
} from './chat-roles.js';
import {
  defineFeatureConversationTable, FeatureConversationOverrideStore,
  type FeatureRecentConversation, type FeatureRpcContext, type FeatureStores,
} from './console/module.js';
import {
  installFeatureSelfService, platformMappingOf, readFeatureSelfServiceConfig, type FeatureSelfServiceConfig,
} from './feature-self-service.js';

export interface FeatureHostOptions {
  readonly database: DatabaseHost;
  readonly hostConfig: unknown;
  /** Startup configuration document (endpoint lists for configured owners). */
  readonly config: unknown;
  readonly endpointRoles: Pick<EndpointRoleResolver, 'resolveOwner' | 'resolveTrusted'>;
  readonly snapshots: () => SnapshotReader;
}

export interface FeatureHost {
  readonly stores: FeatureStores;
  readonly roles: ChatRoleService;
  readonly selfService: FeatureSelfServiceConfig;
  /** Root resources: the conversation reader, the load step and (when enabled) the chat commands. */
  install(deps: Readonly<{
    context: Omit<FeatureRpcContext, 'authorize' | 'actor' | 'allowedFields' | 'authScope' | 'stores'>;
    audit?: (entry: ConsoleAuditEntry) => void;
  }>): RootResourceInstaller;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function configuredEndpoints(config: RuntimeConfigDocument | undefined): readonly (readonly [string, string])[] {
  if (!config) return [];
  const plugins = record(config.plugins) ? Object.keys(config.plugins) : [];
  return plugins.flatMap(alias => {
    const block = (config as Record<string, unknown>)[alias] as { endpoints?: unknown } | undefined;
    return Array.isArray(block?.endpoints)
      ? block.endpoints.flatMap(item => record(item) && typeof item.id === 'string' ? [[alias, item.id] as const] : [])
      : [];
  });
}

function idList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return typeof value === 'string' ? value.split(/[\s,]+/u).filter(Boolean) : [];
}

/** Must be created before the DatabaseHost starts (tables are defined here). */
export function createFeatureHost(options: FeatureHostOptions): FeatureHost {
  defineFeatureConversationTable(options.database);
  defineChatRoleTable(options.database);
  const selfService = readFeatureSelfServiceConfig(options.hostConfig);
  const conversations = new FeatureConversationOverrideStore({ database: options.database });
  const trigger = record(options.hostConfig) && record(options.hostConfig.ai) && record(options.hostConfig.ai.trigger) ? options.hostConfig.ai.trigger : {};
  const platform = createPlatformChatRoleSource(() => platformMappingOf(selfService));
  const roles = new ChatRoleService({
    store: new ChatRoleStore({ database: options.database }),
    sources: [
      createConfigChatRoleSource({
        resolveOwner: (alias, endpointId) => options.endpointRoles.resolveOwner(alias, endpointId),
        resolveTrusted: (alias, endpointId) => options.endpointRoles.resolveTrusted(alias, endpointId),
        endpoints: () => configuredEndpoints(options.config as RuntimeConfigDocument | undefined),
        globalOwners: () => idList(trigger.masters),
        globalTrusted: () => idList(trigger.trusted),
      }),
      platform,
    ],
  });
  const recentConversations = async (limit: number): Promise<readonly FeatureRecentConversation[]> => {
    const raw = options.database.started ? options.database.getRawDatabase() as { models?: Map<string, unknown> } | undefined : undefined;
    const model = raw?.models?.get('conversation_events') as {
      select(...fields: string[]): { groupBy?(...fields: string[]): unknown; limit(count: number): PromiseLike<Record<string, unknown>[]> };
    } | undefined;
    if (!model) throw new Error('conversation store unavailable');
    const columns = ['endpoint_id', 'conversation_kind', 'conversation_id'];
    const query = model.select(...columns);
    query.groupBy?.(...columns);
    const rows = await query.limit(limit);
    const lease = options.snapshots().acquire();
    try {
      return rows.flatMap(row => {
        try {
          const endpoint = decodeStorageIdentity(String(row.endpoint_id));
          const id = decodeStorageIdentity(String(row.conversation_id));
          const key = resolveEndpointFeatureKey(lease.value, endpoint, undefined, { kind: row.conversation_kind, id });
          return key && key.split('/').length >= 3 ? [{ key }] : [];
        } catch { return []; }
      });
    } finally { lease.release(); }
  };
  const stores: FeatureStores = Object.freeze({ conversations, roles, recentConversations });
  let loaded = false;
  const install: FeatureHost['install'] = deps => context => {
    context.resources.provide(featureConversationOverridesToken, conversations.reader);
    context.handoff.add({
      activateNext: async signal => {
        signal.throwIfAborted();
        if (loaded) return;
        await conversations.load(id => getLogger('feature').warn(`Skipped malformed conversation override ${id}`));
        await roles.store.load();
        loaded = true;
      },
    });
    installFeatureSelfService({
      config: selfService, roles, snapshots: options.snapshots(),
      context: { ...deps.context, stores },
      onActor: actor => platform.record(actor.identity, actor.context),
      ...(deps.context.publishEvent ? { publishEvent: deps.context.publishEvent } : {}),
      ...(deps.audit ? { audit: deps.audit } : {}),
    })(context);
  };
  return Object.freeze({ stores, roles, selfService, install });
}
