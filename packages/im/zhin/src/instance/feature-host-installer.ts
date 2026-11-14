/**
 * ADR 0055 / 0056 / 0057: adapter / endpoint / conversation feature overrides and chat roles for the instance.
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
  type DatabaseHost, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { ChatRoleStore, defineChatRoleTable, type InstanceChatRoleService } from './chat-roles.js';
import {
  defineFeatureOverrideTable, FeatureOverrideStore, readWorkspaceConversationNames,
  type FeatureRecentConversation, type FeatureRpcContext, type FeatureStores,
} from './console/module.js';
import { installFeatureSelfService, readFeatureSelfServiceConfig, type FeatureSelfServiceConfig } from './feature-self-service.js';

export interface FeatureHostOptions {
  readonly database: DatabaseHost;
  readonly hostConfig: unknown;
  readonly snapshots: () => SnapshotReader;
  /**
   * Runs once after the stores loaded (configuration migration, ADR 0056 §3); `candidate` is the
   * generation being activated (its adapter capability profiles classify the migration targets).
   */
  readonly afterLoad?: (roles: InstanceChatRoleService, candidate: RuntimeSnapshot | undefined, overrides: FeatureOverrideStore) => Promise<void>;
}

export interface FeatureHost {
  readonly stores: FeatureStores;
  readonly roles: InstanceChatRoleService;
  /** A global owner with an identity on the account's adapter (owner approval address). */
  resolveEndpointOwner(alias: string, endpointId: string): string | undefined;
  readonly selfService: FeatureSelfServiceConfig;
  /** Root resources: the conversation reader, the load step and (when enabled) the chat commands. */
  install(deps: Readonly<{
    context: Omit<FeatureRpcContext, 'authorize' | 'actor' | 'allowedFields' | 'authScope' | 'stores'>;
    audit?: (entry: ConsoleAuditEntry) => void;
  }>): RootResourceInstaller;
}

/** Newest conversation events scanned for the Console's recent-conversation list. */
export const RECENT_EVENT_WINDOW = 5_000;

/** Must be created before the DatabaseHost starts (tables are defined here). */
export function createFeatureHost(options: FeatureHostOptions): FeatureHost {
  defineFeatureOverrideTable(options.database);
  defineChatRoleTable(options.database);
  const selfService = readFeatureSelfServiceConfig(options.hostConfig);
  const overrides = new FeatureOverrideStore({ database: options.database });
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database: options.database }) });
  // Owner approvals (tool hard gate, self-changes) grant host-wide authority, so only a global
  // owner with an identity on this adapter is asked (ADR 0056 §2); account-level owners are not.
  const resolveEndpointOwner = (alias: string, _endpointId: string): string | undefined => {
    try { return roles.ownersOf('', alias)[0]; } catch { return undefined; }
  };
  /**
   * Recently active conversations, newest first. Reads only the newest {@link RECENT_EVENT_WINDOW}
   * events by primary key (no whole-table aggregation), keeps each conversation's latest event and
   * stops at `limit` distinct keys.
   */
  const recentConversations = async (limit: number): Promise<readonly FeatureRecentConversation[]> => {
    const raw = options.database.started ? options.database.getRawDatabase() as { models?: Map<string, unknown> } | undefined : undefined;
    type Selection = PromiseLike<Record<string, unknown>[]> & {
      orderBy?(field: string, direction?: 'ASC' | 'DESC'): Selection;
      limit(count: number): Selection;
    };
    const model = raw?.models?.get('conversation_events') as { select(...fields: string[]): Selection } | undefined;
    if (!model) throw new Error('conversation store unavailable');
    const query = model.select('id', 'time', 'endpoint_id', 'conversation_kind', 'conversation_id');
    if (typeof query.orderBy !== 'function') throw new Error('conversation store cannot order events');
    const rows = await query.orderBy('id', 'DESC').limit(RECENT_EVENT_WINDOW);
    const lease = options.snapshots().acquire();
    try {
      const seen = new Map<string, FeatureRecentConversation>();
      for (const row of rows) {
        if (seen.size >= limit) break;
        try {
          const endpoint = decodeStorageIdentity(String(row.endpoint_id));
          const id = decodeStorageIdentity(String(row.conversation_id));
          const key = resolveEndpointFeatureKey(lease.value, endpoint, undefined, { kind: row.conversation_kind, id });
          if (!key || key.split('/').length < 3 || seen.has(key)) continue;
          const time = Number(row.time);
          seen.set(key, Object.freeze({ key, ...(Number.isFinite(time) && time > 0 ? { lastActiveAt: time } : {}) }));
        } catch { /* undecodable identity: skipped */ }
      }
      return Object.freeze([...seen.values()]);
    } finally { lease.release(); }
  };
  // Console-given conversation names (Sandbox sessions) so override lists show more than an id (#1250).
  const conversationNames = (keys: readonly string[]) => readWorkspaceConversationNames(options.database, options.snapshots(), keys);
  const stores: FeatureStores = Object.freeze({ overrides, roles, recentConversations, conversationNames });
  let loaded = false;
  const install: FeatureHost['install'] = deps => context => {
    context.resources.provide(featureConversationOverridesToken, overrides.reader);
    context.handoff.add({
      activateNext: async signal => {
        signal.throwIfAborted();
        if (loaded) return;
        await overrides.load(id => getLogger('feature').warn(`Skipped malformed feature override ${id}`));
        await roles.store.load();
        let candidate: RuntimeSnapshot | undefined;
        try { candidate = context.readCandidateSnapshot?.(); } catch { candidate = undefined; }
        await options.afterLoad?.(roles, candidate, overrides);
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
