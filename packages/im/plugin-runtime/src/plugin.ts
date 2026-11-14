/**
 * Canonical plugin definition consumed from `zhin.js`.
 * @module zhin.js
 */
import type { Dispose, DisposeStack } from './dispose.js';
import type { GenerationHandoffRegistry } from './handoff.js';
import type { FeatureId, PluginId } from './identity.js';
import type { Scope, Token } from './token.js';
import type { FeatureTarget } from './layered-config.js';
import type { PluginEventSubscriptions } from './plugin-events.js';
import { freezePluginConfigUpdate, type PluginConfigUpdateDeclaration } from './config-update-declaration.js';
import {
  definePluginConsoleRpc,
  pluginConsoleRpcToken,
  type PluginConsoleRpc,
  type PluginConsoleRpcDefinition,
} from './plugin-console-rpc.js';
import { pluginTaskProviderToken, type PluginTaskProvider } from './plugin-tasks.js';
import { pluginVerificationToken, type PluginVerificationHost } from './plugin-verification.js';
import {
  pluginDataMigrationProviderToken,
  type PluginDataMigrationProvider,
} from './data-migration.js';
export { freezePluginConfigUpdate } from './config-update-declaration.js';
export type { PluginConfigUpdateDeclaration } from './config-update-declaration.js';
export {
  definePluginStore,
  type PluginStore,
  type PluginStoreOptions,
  type PluginStoreCarrier,
  type ResourceReaderCarrier,
  type SetupResourceCarrier,
} from './store.js';
export { pluginTaskProviderToken, type PluginTaskProvider } from './plugin-tasks.js';
export { pluginVerificationToken, type PluginVerificationHost } from './plugin-verification.js';

export interface PluginMetadata {
  readonly displayName?: string;
  /**
   * Console-only translations of `displayName`, keyed by interface locale (`zh-CN` / `en`).
   * The Console falls back to `en`, then `displayName`, then the instance key.
   */
  readonly displayNameI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
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
  /**
   * Effective configuration for one adapter / endpoint (ADR 0050): `global ← adapter ← endpoint`,
   * merged, frozen and cached per configuration generation. `target` is a message, an explicit
   * `{ adapter: <instance alias>, endpointId? }` or a resolution key such as `'qq/bot-1'`.
   * Reads the latest committed configuration, so in-place override changes are visible without reload.
   */
  configFor(target: FeatureTarget): Readonly<TConfig>;
  /** Effective enable state for one adapter / endpoint; an upper-level disable always wins. */
  isEnabledFor(target: FeatureTarget): boolean;
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

export interface PluginSetupCapabilities<TConfig = Record<string, unknown>> {
  readonly consoleRpc?: PluginConsoleRpc | PluginConsoleRpcDefinition<TConfig>;
  readonly tasks?: PluginTaskProvider;
  readonly verification?: PluginVerificationHost;
  readonly dataMigration?: PluginDataMigrationProvider;
  readonly dispose?: Dispose;
}

export type PluginSetupResult<TConfig = Record<string, unknown>> =
  | void
  | Dispose
  | PluginSetupCapabilities<TConfig>;

export interface PluginCapabilityGraphDeclaration {
  readonly provides?: readonly (Token<unknown> | string)[];
  readonly injects?: readonly (Token<unknown> | string)[];
  readonly features?: Readonly<Record<string, readonly string[]>>;
}

export function definePluginCapabilityGraph(
  graph: PluginCapabilityGraphDeclaration,
): Readonly<PluginCapabilityGraphDeclaration> {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new TypeError('Plugin capabilityGraph must be an object');
  }
  const provides =
    graph.provides !== undefined ? Object.freeze([...graph.provides]) : undefined;
  const injects =
    graph.injects !== undefined ? Object.freeze([...graph.injects]) : undefined;
  let features: Readonly<Record<string, readonly string[]>> | undefined;
  if (graph.features !== undefined) {
    if (!graph.features || typeof graph.features !== 'object' || Array.isArray(graph.features)) {
      throw new TypeError('Plugin capabilityGraph.features must be an object');
    }
    const frozenEntries: Record<string, readonly string[]> = {};
    for (const [featureKey, items] of Object.entries(graph.features)) {
      if (!Array.isArray(items)) {
        throw new TypeError(`Plugin capabilityGraph.features.${featureKey} must be an array`);
      }
      frozenEntries[featureKey] = Object.freeze([...items]);
    }
    features = Object.freeze(frozenEntries);
  }
  return Object.freeze({
    ...(provides !== undefined ? { provides } : {}),
    ...(injects !== undefined ? { injects } : {}),
    ...(features !== undefined ? { features } : {}),
  });
}

/**
 * Merges a plugin's explicitly declared `capabilityGraph` with convention-discovered
 * feature directories (`commands`, `tools`, `skills`, `handlers`, `middlewares`, `components`,
 * `pages`, `schedules`, `mcps`, `hooks`, `agents`, `adapters`).
 *
 * Plugins only need to declare cross-plugin `provides` / `injects` by hand; convention
 * directories are automatically unioned into `features` and deduplicated in sorted order.
 */
export function mergePluginCapabilityGraph(
  declared: PluginCapabilityGraphDeclaration | undefined,
  discoveredFeatures: Readonly<Record<string, readonly string[]>>,
): Readonly<PluginCapabilityGraphDeclaration> {
  const base = declared ? definePluginCapabilityGraph(declared) : {};
  const mergedFeatures: Record<string, readonly string[]> = {};
  const keys = new Set<string>([
    ...Object.keys(base.features ?? {}),
    ...Object.keys(discoveredFeatures ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const combined = [
      ...(base.features?.[key] ?? []),
      ...(discoveredFeatures?.[key] ?? []),
    ];
    const unique = [...new Set(combined)].filter(Boolean).sort();
    if (unique.length > 0) {
      mergedFeatures[key] = Object.freeze(unique);
    }
  }
  return Object.freeze({
    ...(base.provides !== undefined ? { provides: base.provides } : {}),
    ...(base.injects !== undefined ? { injects: base.injects } : {}),
    ...(Object.keys(mergedFeatures).length > 0 ? { features: Object.freeze(mergedFeatures) } : {}),
  });
}

export interface PluginDefinition<TConfig = unknown> {
  readonly name: string;
  readonly config?: PluginConfigSchema<TConfig>;
  readonly metadata?: PluginMetadata;
  readonly requires?: readonly Token<unknown>[];
  readonly capabilityGraph?: PluginCapabilityGraphDeclaration;
  /** Fields owned by Features; setup must not capture these as mutable business configuration. */
  readonly configUpdate?: PluginConfigUpdateDeclaration;
  setup?(
    context: PluginSetupContext<TConfig>,
  ): PluginSetupResult<TConfig> | Promise<PluginSetupResult<TConfig>>;
}

const pluginNamePattern = /^[a-z][a-z0-9-]*$/;

function isPluginConsoleRpc(value: unknown): value is PluginConsoleRpc {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'methods' in value &&
      (value as { methods?: unknown }).methods instanceof Map,
  );
}

function applySetupResult<TConfig>(
  context: PluginSetupContext<TConfig>,
  result: PluginSetupResult<TConfig>,
): void | Dispose {
  if (!result || typeof result === 'function') {
    return result;
  }
  if (result.consoleRpc !== undefined) {
    const rpc = isPluginConsoleRpc(result.consoleRpc)
      ? result.consoleRpc
      : definePluginConsoleRpc(result.consoleRpc as PluginConsoleRpcDefinition<TConfig>);
    context.resources.provide(pluginConsoleRpcToken, rpc);
  }
  if (result.tasks !== undefined) {
    context.resources.provide(pluginTaskProviderToken, result.tasks);
  }
  if (result.verification !== undefined) {
    context.resources.provide(pluginVerificationToken, result.verification);
  }
  if (result.dataMigration !== undefined) {
    context.resources.provide(pluginDataMigrationProviderToken, result.dataMigration);
  }
  return result.dispose;
}

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
  const originalSetup = definition.setup;
  const wrappedSetup: PluginDefinition<TConfig>['setup'] =
    typeof originalSetup === 'function'
      ? (context) => {
          const outcome = originalSetup.call(definition, context);
          if (outcome && typeof (outcome as PromiseLike<unknown>).then === 'function') {
            return Promise.resolve(outcome).then((resolved) => applySetupResult(context, resolved));
          }
          return applySetupResult(context, outcome as PluginSetupResult<TConfig>);
        }
      : undefined;
  return Object.freeze({
    ...definition,
    ...(wrappedSetup ? { setup: wrappedSetup } : {}),
    metadata: definition.metadata ? Object.freeze({
      ...definition.metadata,
      ...(definition.metadata.displayNameI18n
        ? { displayNameI18n: Object.freeze({ ...definition.metadata.displayNameI18n }) }
        : {}),
    }) : undefined,
    requires: Object.freeze([...(definition.requires ?? [])]),
    ...(definition.capabilityGraph !== undefined
      ? { capabilityGraph: definePluginCapabilityGraph(definition.capabilityGraph) }
      : {}),
    ...(definition.configUpdate !== undefined ? { configUpdate: freezePluginConfigUpdate(definition.configUpdate) } : {}),
  });
}

// The application facade exposes these Host contracts beside definePlugin.
export { createDeliveryTarget, type DeliveryTarget } from './delivery-target.js';
export { PluginStateStore, type JsonValue, type JsonSerializable, type StateScope, type StateRecord,
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
