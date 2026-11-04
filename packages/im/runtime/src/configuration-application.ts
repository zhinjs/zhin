import type { RuntimeConfigDocument, RuntimeSnapshot, SnapshotLease, Token } from '@zhin.js/plugin-runtime';

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

/** Trusted process-owned consumers may defer an instance's configuration and
 * package binding together. Runtime owns masking; selectors cannot publish data.
 */
export interface RootPluginConfigurationSelection {
  select(input: Readonly<{
    previous: RuntimeConfigDocument;
    next: RuntimeConfigDocument;
    expand<T>(value: T): T;
  }>): readonly Readonly<{ instanceKey: string; reasonCode: string }>[];
}

/** Trusted Host composition only. Each handler owns a dependency-closed group;
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
