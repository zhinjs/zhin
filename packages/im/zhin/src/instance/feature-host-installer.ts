/**
 * ADR 0055 / 0056 / 0057: adapter / endpoint / conversation feature overrides and chat roles for the instance.
 * Defines the instance-owned tables, loads them once the DatabaseHost started, provides the
 * conversation read side to the Runtime (dispatch gates, `configFor` / `isEnabledFor`), the chat
 * role resolution behind `sender.chatRole`, and installs the in-chat `feature` / `role` commands
 * when `features.selfService.enabled` is true.
 */
import { ChatRoleService, chatRolesToken, createChatRoleReader, type ChatIdentitySighting, type ChatRoleReader } from '@zhin.js/core';
import type { GatewayToInstanceMessage } from '@zhin.js/host-http/bridge';
import type { ConsoleAuditEntry } from '@zhin.js/host-http';
import { getLogger } from '@zhin.js/logger';
import {
  decodeStorageIdentity, featureConversationOverridesToken, resolveEndpointFeatureKey,
  type DatabaseHost, type RuntimeSnapshot, type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { ChatRoleStore, defineChatRoleTable, type InstanceChatRoleService } from './chat-roles.js';
import { defineChatPrincipalTables } from './chat-principals.js';
import { ChatPeople } from './chat-people.js';
import { ChatIdentityBindCodes, installChatIdentityBind } from './chat-identity-bind.js';
import { ChatOwnerClaim, installChatOwnerClaim } from './chat-owner-claim.js';
import { ChatRoleImportBook, chatRoleMigrationAdapterKinds, type ChatRoleAudit } from './chat-role-migration.js';
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
  readonly afterLoad?: (
    roles: InstanceChatRoleService, candidate: RuntimeSnapshot | undefined, overrides: FeatureOverrideStore,
    audit: ChatRoleAudit | undefined,
  ) => Promise<void>;
  /**
   * Project root: enables the claim code file (`zhin status`) and the Console side of the role
   * migration record (ADR 0060 §3.3 / §4.2). Without it neither is offered.
   */
  readonly projectRoot?: string;
  /**
   * The gateway control channel (ADR 0054 §3): `principal-revoked` for a deleted / disabled
   * Console user removes that user's person link (ADR 0060 §2.4). Absent standalone.
   */
  readonly gatewayMessages?: Readonly<{ onMessage(listener: (message: GatewayToInstanceMessage) => void): () => void }>;
}

/** Console user lifecycle reasons that end a person ↔ Console link (`ConsoleCredentialRevocationReason`). */
const LINK_ENDING_REASONS: ReadonlySet<string> = new Set(['deleted', 'disabled']);
/** How often the 90-day display name cache is swept (ADR 0060 Q11). */
const SIGHTING_SWEEP_MS = 24 * 60 * 60_000;

export interface FeatureHost {
  readonly stores: FeatureStores;
  readonly roles: InstanceChatRoleService;
  /** A global owner with an identity on the account's adapter (owner approval address). */
  resolveEndpointOwner(alias: string, endpointId: string): string | undefined;
  readonly selfService: FeatureSelfServiceConfig;
  /** Read-only chat roles for plugins (`chatRolesToken`, ADR 0060 §6). */
  readonly reader: ChatRoleReader;
  /** ADR 0060 §3.3: the first global owner without a Console (open while there is none). */
  readonly claim: ChatOwnerClaim;
  /** ADR 0060 §2: people behind chat identities. */
  readonly people: ChatPeople;
  /** Inbound sightings (`createSenderEnricher({ observe })`): display name cache, recent speakers. */
  observe(sighting: ChatIdentitySighting): void;
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
  defineChatPrincipalTables(options.database);
  const selfService = readFeatureSelfServiceConfig(options.hostConfig);
  const overrides = new FeatureOverrideStore({ database: options.database });
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({
    database: options.database,
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    onMigrated: ({ migrated, backup }) => getLogger('chat-roles').info(`聊天角色：${migrated} 条授予已迁移为「人」模型（ADR 0060）`
      + (backup ? `；迁移前的数据已导出到 ${backup}` : '')),
  }) });
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
  let audit: ChatRoleAudit | undefined;
  const adapterKind = () => {
    const lease = options.snapshots().acquire();
    try { return chatRoleMigrationAdapterKinds(lease.value); } finally { lease.release(); }
  };
  const chatRoleImports = options.projectRoot
    ? new ChatRoleImportBook({ projectRoot: options.projectRoot, roles: () => roles, adapterKind, audit: entry => audit?.(entry) })
    : undefined;
  const claim = new ChatOwnerClaim({ roles, ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    logger: getLogger('chat-roles'), audit: () => audit });
  const people = new ChatPeople({ store: roles.store, audit: () => audit });
  const bindCodes = new ChatIdentityBindCodes({ people });
  options.gatewayMessages?.onMessage(message => {
    if (message.type !== 'principal-revoked' || !LINK_ENDING_REASONS.has(message.payload.reason ?? '')) return;
    bindCodes.revoke(message.payload.principalId);
    void people.consoleUserRemoved(message.payload.principalId, message.payload.reason!)
      .catch(error => getLogger('chat-roles').warn(`Chat principal link not removed: ${(error as Error).message}`));
  });
  const reader = createChatRoleReader({
    roles: () => roles,
    conversationKey: conversation => {
      const lease = options.snapshots().acquire();
      try { return resolveEndpointFeatureKey(lease.value, conversation.endpoint.id, undefined, conversation); }
      finally { lease.release(); }
    },
    subscribe: listener => roles.store.subscribe(listener),
  });
  // Console-given conversation names (Sandbox sessions) so override lists show more than an id (#1250).
  const conversationNames = (keys: readonly string[]) => readWorkspaceConversationNames(options.database, keys);
  const stores: FeatureStores = Object.freeze({ overrides, roles, recentConversations, conversationNames, claim, people, bindCodes,
    ...(chatRoleImports ? { chatRoleImports } : {}) });
  let loaded = false;
  const install: FeatureHost['install'] = deps => context => {
    if (deps.audit) audit = deps.audit;
    context.resources.provide(featureConversationOverridesToken, overrides.reader);
    context.resources.provide(chatRolesToken, reader);
    context.handoff.add({
      activateNext: async signal => {
        signal.throwIfAborted();
        if (loaded) return;
        await overrides.load(id => getLogger('feature').warn(`Skipped malformed feature override ${id}`));
        await roles.store.load();
        let candidate: RuntimeSnapshot | undefined;
        try { candidate = context.readCandidateSnapshot?.(); } catch { candidate = undefined; }
        await options.afterLoad?.(roles, candidate, overrides, audit);
        loaded = true;
        await claim.refresh().catch(error => getLogger('chat-roles').warn(`Chat owner claim unavailable: ${(error as Error).message}`));
        const sweep = () => void people.expireSightings().catch(() => undefined);
        sweep();
        setInterval(sweep, SIGHTING_SWEEP_MS).unref?.();
      },
    });
    installChatOwnerClaim({ claim, snapshots: options.snapshots() })(context);
    installChatIdentityBind({ codes: bindCodes, snapshots: options.snapshots() })(context);
    installFeatureSelfService({
      config: selfService, roles, snapshots: options.snapshots(),
      context: { ...deps.context, stores },
      ...(deps.context.publishEvent ? { publishEvent: deps.context.publishEvent } : {}),
      ...(deps.audit ? { audit: deps.audit } : {}),
    })(context);
  };
  const observe = (sighting: ChatIdentitySighting) => { if (loaded) people.observe(sighting); };
  return Object.freeze({ stores, roles, reader, claim, people, observe, resolveEndpointOwner, selfService, install });
}
