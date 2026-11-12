/**
 * ADR 0055 / 0056: conversation-level feature overrides and chat roles for the instance.
 * Defines the instance-owned tables, loads them once the DatabaseHost started, provides the
 * conversation read side to the Runtime (dispatch gates, `configFor` / `isEnabledFor`), the chat
 * role resolution behind `sender.chatRole`, and installs the in-chat `feature` / `role` commands
 * when `features.selfService.enabled` is true.
 */
import { ChatRoleService } from '@zhin.js/core';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import {
  decodeStorageIdentity, featureConversationOverridesToken, resolveEndpointFeatureKey,
  type DatabaseHost, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { ChatRoleStore, defineChatRoleTable, type InstanceChatRoleService } from './chat-roles.js';
import {
  defineFeatureConversationTable, FeatureConversationOverrideStore,
  type FeatureRecentConversation, type FeatureRpcContext, type FeatureStores,
} from './console/module.js';
import { installFeatureSelfService, readFeatureSelfServiceConfig, type FeatureSelfServiceConfig } from './feature-self-service.js';

export interface FeatureHostOptions {
  readonly database: DatabaseHost;
  readonly hostConfig: unknown;
  readonly snapshots: () => SnapshotReader;
  /** Runs once after the stores loaded (configuration migration, ADR 0056 §3). */
  readonly afterLoad?: (roles: InstanceChatRoleService) => Promise<void>;
}

export interface FeatureHost {
  readonly stores: FeatureStores;
  readonly roles: InstanceChatRoleService;
  /** Stored owners of an account, closest scope first (owner approval address). */
  resolveEndpointOwner(alias: string, endpointId: string): string | undefined;
  readonly selfService: FeatureSelfServiceConfig;
  /** Root resources: the conversation reader, the load step and (when enabled) the chat commands. */
  install(deps: Readonly<{
    context: Omit<FeatureRpcContext, 'authorize' | 'actor' | 'allowedFields' | 'authScope' | 'stores'>;
    audit?: (entry: ConsoleAuditEntry) => void;
  }>): RootResourceInstaller;
}

/** Must be created before the DatabaseHost starts (tables are defined here). */
export function createFeatureHost(options: FeatureHostOptions): FeatureHost {
  defineFeatureConversationTable(options.database);
  defineChatRoleTable(options.database);
  const selfService = readFeatureSelfServiceConfig(options.hostConfig);
  const conversations = new FeatureConversationOverrideStore({ database: options.database });
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database: options.database }) });
  const resolveEndpointOwner = (alias: string, endpointId: string): string | undefined => {
    try { return roles.ownersOf(`${alias}/${endpointId}`, alias)[0]; } catch { return undefined; }
  };
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
        await options.afterLoad?.(roles);
        loaded = true;
      },
    });
    installFeatureSelfService({
      config: selfService, roles, snapshots: options.snapshots(),
      context: { ...deps.context, stores },
      ...(deps.context.publishEvent ? { publishEvent: deps.context.publishEvent } : {}),
      ...(deps.audit ? { audit: deps.audit } : {}),
    })(context);
  };
  return Object.freeze({ stores, roles, resolveEndpointOwner, selfService, install });
}
