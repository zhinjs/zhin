/**
 * Canonical plugin definition consumed from `zhin.js`.
 * @module zhin.js
 */
import type { Dispose, DisposeStack } from './dispose.js';
import type { GenerationHandoffRegistry } from './handoff.js';
import type { FeatureId, PluginId } from './identity.js';
import type { Scope, Token } from './token.js';
import type { PluginEventSubscriptions } from './plugin-events.js';

export interface PluginMetadata {
  readonly displayName?: string;
  readonly icon?: string;
  readonly order?: number;
}

export interface ConfigView<T> {
  get(): Readonly<T>;
}

/** Structural schema contract; the Runtime owns validation and defaults. */
export interface PluginConfigSchema<TConfig> {
  readonly output?: TConfig;
  toJsonSchema(): Readonly<Record<string, unknown>>;
}

export interface PluginInstanceView {
  readonly id: PluginId;
  readonly instanceKey: string;
  readonly parent?: PluginId;
  readonly root: PluginId;
  readonly role: 'root' | 'child';
}

export interface PluginSetupContext<TConfig = unknown> {
  readonly events: PluginEventSubscriptions;
  readonly signal: AbortSignal;
  readonly plugin: PluginInstanceView;
  readonly config: ConfigView<TConfig>;
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
  readonly handoff: GenerationHandoffRegistry;
  /**
   * Registers an in-memory definition through the same validation and
   * projection transaction used by convention-discovered capabilities.
   * @internal Runtime bridge for feature installers; plugin authors use convention files.
   */
  addFeature<TDefinition>(
    feature: FeatureId | string,
    localName: string,
    definition: TDefinition,
  ): void;
}

export {
  type PluginEventSubscriptions,
  type PluginLifecycleEvent,
  type PluginLifecycleEventMap,
  type HmrEventDetails,
  type HmrResumeDetails,
  type HmrReloadScope,
  type HmrOutcome,
} from './plugin-events.js';

export interface PluginDefinition<TConfig = unknown> {
  readonly name: string;
  readonly config?: PluginConfigSchema<TConfig>;
  readonly metadata?: PluginMetadata;
  readonly requires?: readonly Token<unknown>[];
  setup?(context: PluginSetupContext<TConfig>): void | Dispose | Promise<void | Dispose>;
}

const pluginNamePattern = /^[a-z][a-z0-9-]*$/;

/**
 * Define the canonical `plugin.ts` entry point.
 * Setup runs against one candidate generation and may return its disposer.
 *
 * @public
 * @example
 * ```ts
 * import { definePlugin } from 'zhin.js';
 *
 * // plugin.ts
 * export default definePlugin({
 *   name: 'hello',
 * });
 * ```
 *
 * Put capabilities in convention files such as `commands/hello/index.ts`, each with
 * one default export.
 */
export function definePlugin<TConfig = unknown>(
  definition: PluginDefinition<TConfig>,
): Readonly<PluginDefinition<TConfig>> {
  if (!pluginNamePattern.test(definition.name)) {
    throw new TypeError(`Invalid plugin name: ${definition.name}`);
  }
  if (definition.config !== undefined && typeof definition.config.toJsonSchema !== 'function') {
    throw new TypeError('Plugin config must declare a schema with toJsonSchema()');
  }
  return Object.freeze({
    ...definition,
    metadata: definition.metadata ? Object.freeze({ ...definition.metadata }) : undefined,
    requires: Object.freeze([...(definition.requires ?? [])]),
  });
}

// The application facade exposes these Host contracts beside definePlugin.
export { createDeliveryTarget, type DeliveryTarget } from './delivery-target.js';
export { PluginStateStore, type JsonValue, type StateScope, type StateRecord,
  type PersistentStatePort, type StateWriteOptions } from './persistent-state.js';
export {
  databaseHostToken,
  type DatabaseHostConsole,
  type DatabaseHostModel,
  type DatabaseHostTransaction,
  type DatabaseHostSelection,
  type DatabaseHostSelectResult,
  type DatabaseHostTable,
  type DatabaseHostType,
  PluginDatabaseHost,
} from './database-host.js';
export {
  outboundHostToken,
  type OutboundConversation,
  type OutboundEditInput,
  type OutboundEndpointCapabilities,
  type OutboundEndpointInput,
  type OutboundEndpointOperation,
  type OutboundHost,
  type OutboundCaptureInput,
  type CapturedOutboundOperation,
  type OutboundMessage,
  type OutboundReactionInput,
  type OutboundRecallInput,
  type OutboundRemoveReactionInput,
  type OutboundSendInput,
  type OutboundTypingInput,
} from './outbound-host.js';
export {
  scheduleHostToken,
  PluginScheduleHost,
  type ScheduleJobRegistration,
} from './schedule-host.js';

export {
  DataMigrationError,
  pluginDataMigrationProviderToken,
  type DataMigrationCandidate,
  type DataMigrationInventory,
  type DataMigrationRequest,
  type PrepareDataMigrationRequest,
  type DataMigrationPlan,
  type ApplyDataMigrationRequest,
  type DataMigrationReceipt,
  type ResumeDataMigrationRequest,
  type RestoreDataMigrationRequest,
  type InspectDataMigrationRequest,
  type DataMigrationInspection,
  type PluginDataMigrationProvider,
} from './data-migration.js';

export {
  TargetMigrationScopes,
  targetMigrationDigest,
  orderedMigrationRows,
  createRelationalTargetMigration,
  type TargetMigrationRows,
  type TargetMigrationWrite,
  type RelationalTargetMigrationUnit,
  type RelationalTargetMigrationOptions,
} from './relational-target-migration.js';
