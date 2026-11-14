import type { GenerationAdmissionGate } from './admission.js';
import type { DisposeStack } from './dispose.js';
import type { GenerationHandoffRegistry } from './handoff.js';
import type { FeatureId } from './identity.js';
import type { PluginEventSubscriptions } from './plugin.js';
import type { RuntimeConfigDocument } from './root-config-document.js';
import type { RuntimeSnapshot, SnapshotLease } from './snapshot.js';
import { createToken, type Scope, type Token } from './token.js';

export const primaryConfigToken = createToken<PrimaryConfig>(
  'zhin.primary-config',
  'Validated Root configuration for the current generation',
);

/**
 * Generation-owned, validated Root configuration.
 *
 * `document` deliberately retains environment placeholders for safe display and
 * persistence. Runtime consumers use `expanded`, which is derived exclusively
 * through the Root EnvStore instead of reading process.env themselves.
 */
export interface PrimaryConfig {
  /** Actual Runtime composition branch; absent on older authorities, never inferred from values. */
  readonly compositionMode?: 'document' | 'custom' | 'unknown';
  readonly document: RuntimeConfigDocument;
  readonly expanded: RuntimeConfigDocument;
  get<T = unknown>(key: string): T | undefined;
}

export interface RootResourceContext {
  readonly events: PluginEventSubscriptions;
  /** Whether this generation has loaded a provider for the requested Feature. */
  readonly hasFeature?: (feature: FeatureId | string) => boolean;
  /** Exact shadow generation being assembled; never inferred from a latest snapshot. */
  readonly generation: number;
  /** Exact projected candidate, available during handoff activation, never the committed previous generation. */
  readonly readCandidateSnapshot?: () => RuntimeSnapshot;
  readonly signal: AbortSignal;
  readonly resources: Scope;
  readonly lifecycle: DisposeStack;
  readonly handoff: GenerationHandoffRegistry;
  /** Candidate-wide gate atomically switched by SnapshotStore at commit. */
  readonly admission: GenerationAdmissionGate;
  readonly config: PrimaryConfig;
  /**
   * Adds a root-owned capability to this shadow generation. The definition is
   * validated and projected with convention/setup capabilities; it is never
   * visible before the generation commits.
   */
  addFeature<TDefinition>(
    feature: FeatureId | string,
    localName: string,
    definition: TDefinition,
  ): void;
  /**
   * Declares project files this installer reads itself (bootstrap Markdown, a knowledge folder, ...)
   * (#1250). When a hot reload only changes such files and no module imports them, the Runtime
   * keeps every Plugin Scope and calls `onChange` on the committed Root instead of rebuilding the
   * Root generation. Undeclared project files keep the conservative Root rebuild. Call it during
   * setup only; the declaration lives as long as this Root Scope.
   */
  readonly watchProjectFiles?: (declaration: ProjectFileWatch) => void;
}

/** Project files a Root installer reads, and how it takes in their new content (#1250). */
export interface ProjectFileWatch {
  /**
   * Paths relative to the project root, `/`-separated. `*` matches inside one path segment, `**`
   * any number of segments, `?` one character (`AGENTS.md`, `knowledge/**`, `prompts/*.md`).
   */
  readonly patterns: readonly string[];
  /** Called with the absolute paths of the changed matching files, after they were written. */
  onChange(change: ProjectFileChange): void | Promise<void>;
}

export interface ProjectFileChange {
  readonly files: readonly string[];
}

export type RootResourceInstaller = (
  context: RootResourceContext,
) => void | Promise<void>;

export type ConfigEffect = 'in-place' | 'replace-resource' | 'reconnect-endpoint' | 'reload-plugin' | 'restart-process';

export interface ConfigApplicationGroup {
  readonly id: string;
  readonly paths: readonly (readonly string[])[];
  readonly effect: ConfigEffect;
  readonly status: 'applied' | 'restart-pending' | 'blocked' | 'failed' | 'superseded' | 'unknown';
  readonly reasonCode?: string;
  readonly dependsOn: readonly string[];
}

export interface ConfigApplicationResult {
  readonly operationId: string;
  readonly sourceRevision: string;
  readonly saved: boolean;
  readonly generation: number;
  readonly applicationRevision: number;
  readonly groups: readonly ConfigApplicationGroup[];
}

/**
 * Trusted process-owned consumers may defer an instance's configuration and
 * package binding together. Runtime owns masking; selectors cannot publish data.
 */
export interface RootPluginConfigurationSelection {
  select(input: Readonly<{
    previous: RuntimeConfigDocument;
    next: RuntimeConfigDocument;
    expand<T>(value: T): T;
  }>): readonly Readonly<{ instanceKey: string; reasonCode: string }>[];
}

/**
 * Trusted Host composition only. Each handler owns a dependency-closed group;
 * distinct handlers must be independent. Preparation returns immutable bindings, never SDK mutations.
 */
export interface RootConfigUpdateHandler {
  readonly id: string;
  /** Nonoverlapping paths in Host configuration; all paths in one handler form one dependency group. */
  readonly paths: readonly (readonly string[])[];
  /** Full desired-document validation, before any source write or partial application. */
  validate?(input: Readonly<{
    current: RuntimeSnapshot;
    readRootResource<T>(token: Token<T>): T | undefined;
    expand<T>(value: T): T;
    hasEnvironmentValue(name: string): boolean;
    previous: RuntimeConfigDocument;
    next: RuntimeConfigDocument;
    signal: AbortSignal;
  }>): void | Promise<void>;
  prepare(input: Readonly<{
    current: RuntimeSnapshot;
    readRootResource<T>(token: Token<T>): T | undefined;
    expand<T>(value: T): T;
    hasEnvironmentValue(name: string): boolean;
    previous: RuntimeConfigDocument;
    /** Only this handler's paths have changed; unrelated desired Host settings remain effective-old. */
    next: RuntimeConfigDocument;
    /** Equality proof only; never exposes either desired or effective environment values. */
    environmentValueIsCurrent(name: string): boolean;
    /** Complete validated desired document, for dependency checks only; never publish it wholesale. */
    desired: RuntimeConfigDocument;
    signal: AbortSignal;
  }>): Promise<Readonly<{
    effect: 'in-place' | 'replace-resource';
    rootResources: ReadonlyMap<Token<unknown>, unknown>;
  }> | Readonly<{ effect: 'restart-process'; reasonCode: string }> | undefined>;
}

/** Host-only short control phase. Never run SDK/model requests while holding it. */
export interface RuntimeControlContext {
  readonly lease: SnapshotLease;
  readRootResource<T>(token: Token<T>): T | undefined;
  /** Caller owns this independent lease and must release it on every execution/failure path. */
  retain(): SnapshotLease;
}
