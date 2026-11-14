import { normalizeSourcePath } from './source-path.js';
import { basename } from 'node:path';
import { rootPluginId, type CapabilityId, type PluginId } from '@zhin.js/plugin-runtime';
import type { SourceOwnershipIndex, SourceOwnershipRecord } from './source-ownership.js';
import { isWithin } from './topology-transaction.js';
import type { ManifestFieldChange } from './manifest-change.js';

export interface DependencyImpactPort {
  affectedSources(source: string): readonly string[];
  /** Importers that keep their old instance of the source after a reload (#1250). */
  staleDependents?(source: string): readonly string[];
}

export interface NoInvalidationPlan {
  readonly kind: 'none';
  readonly changed: readonly string[];
  readonly reasons: readonly string[];
}

export interface GenerationInvalidationPlan {
  readonly kind: 'generation';
  readonly changed: readonly string[];
  /** Manifest sources require a graph and process-boundary check before reload. */
  readonly manifestSources: readonly string[];
  readonly slots: readonly CapabilityId[];
  readonly subtrees: readonly PluginId[];
  /** Paths without ownership records; RootRuntime may claim them through a convention. */
  readonly fallbacks: readonly FallbackInvalidation[];
  readonly reasons: readonly string[];
  /**
   * Loaded modules that import a changed source but are not refreshed by this reload, e.g.
   * through a package-name import of a package the runtime cannot revision (#1250
   * `hmr-stale-cross-package-import`). They keep the old code until the process restarts.
   */
  readonly unrefreshedDependents?: readonly string[];
}

export interface FallbackInvalidation {
  readonly source: string;
  readonly owners: readonly PluginId[];
}

export interface ProcessInvalidationPlan {
  readonly kind: 'process';
  readonly changed: readonly string[];
  readonly reasons: readonly string[];
  /** Fields of the changed `package.json` files in this batch, when file watching knew them (#1250). */
  readonly manifestChanges?: readonly ManifestFieldChange[];
}

export type InvalidationPlan =
  | NoInvalidationPlan
  | GenerationInvalidationPlan
  | ProcessInvalidationPlan;

const processFiles = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'yarn.lock',
]);

export class InvalidationPlanner {
  constructor(
    private readonly ownership: SourceOwnershipIndex,
    private readonly dependencies?: DependencyImpactPort,
  ) {}

  plan(sources: readonly string[]): InvalidationPlan {
    const changed = unique(sources.map((source) => normalizeSourcePath(source)));
    if (changed.some((source) => processFiles.has(basename(source)))) {
      return Object.freeze({
        kind: 'process',
        changed,
        reasons: Object.freeze(['workspace dependency state changed']),
      });
    }

    const slots = new Map<CapabilityId, PluginId>();
    const subtrees = new Set<PluginId>();
    const fallbacks: FallbackInvalidation[] = [];
    const manifestSources = new Set<string>();
    const reasons = new Set<string>();
    const processReasons = new Set<string>();
    const unrefreshed = new Set<string>();

    for (const source of changed) {
      if (basename(source) === 'package.json') {
        addManifestSource(manifestSources, reasons, source);
      }
      const affected = unique(
        [source, ...(this.dependencies?.affectedSources(source) ?? [])].map((item) =>
          normalizeSourcePath(item),
        ),
      );
      for (const dependent of this.dependencies?.staleDependents?.(source) ?? []) {
        unrefreshed.add(normalizeSourcePath(dependent));
      }
      let matched = false;
      for (const item of affected) {
        const records = this.ownership.recordsFor(item);
        if (records.length > 0) matched = true;
        for (const record of records) {
          if (requiresProcessRestart(record)) {
            processReasons.add(`Root ${record.role} source changed`);
          } else if (record.role === 'manifest') {
            // Manifest changes are handled by RootRuntime after it compares
            // the current and inspected graphs. Do not turn them into a
            // subtree reload here: that would hide concurrent Slot changes.
            addManifestSource(manifestSources, reasons, record.source);
          } else {
            applyRecord(record, slots, subtrees, reasons);
          }
        }
      }

      // An untracked support module still belongs to the nearest mounted
      // package. RootRuntime gets the first chance to claim it through a
      // mounted Feature convention; unresolved paths retain this fallback.
      if (!matched) {
        const owners = this.ownership.ownersForPath(source);
        if (owners.length > 0) {
          fallbacks.push(Object.freeze({ source, owners }));
          reasons.add(`untracked source changed in ${owners.join(', ')}`);
        }
      }
    }

    if (processReasons.size > 0) {
      return Object.freeze({
        kind: 'process',
        changed,
        reasons: Object.freeze([...processReasons]),
      });
    }

    const roots = collapseSubtrees(subtrees);
    const retainedSlots = [...slots].flatMap(([capability, owner]) =>
      roots.some((root) => isWithin(owner, root)) ? [] : [capability],
    );
    if (
      roots.length === 0
      && retainedSlots.length === 0
      && manifestSources.size === 0
      && fallbacks.length === 0
    ) {
      return Object.freeze({
        kind: 'none',
        changed,
        reasons: Object.freeze([...reasons]),
      });
    }
    return Object.freeze({
      kind: 'generation',
      changed,
      manifestSources: Object.freeze([...manifestSources]),
      slots: Object.freeze(retainedSlots),
      subtrees: Object.freeze(roots),
      fallbacks: Object.freeze(fallbacks),
      reasons: Object.freeze([...reasons]),
      ...(unrefreshed.size > 0 ? { unrefreshedDependents: Object.freeze([...unrefreshed].sort()) } : {}),
    });
  }
}

function addManifestSource(
  manifestSources: Set<string>,
  reasons: Set<string>,
  source: string,
): void {
  const manifest = normalizeSourcePath(source);
  manifestSources.add(manifest);
  reasons.add(`Manifest source changed: ${manifest}`);
}

function requiresProcessRestart(record: SourceOwnershipRecord): boolean {
  return (
    record.owner === rootPluginId()
    && (record.role === 'plugin' || record.role === 'schema')
  );
}

function applyRecord(
  record: SourceOwnershipRecord,
  slots: Map<CapabilityId, PluginId>,
  subtrees: Set<PluginId>,
  reasons: Set<string>,
): void {
  if (record.role === 'capability' && record.capability) {
    slots.set(record.capability, record.owner);
    reasons.add(`Capability source changed: ${record.capability}`);
    return;
  }
  subtrees.add(record.owner);
  reasons.add(`${record.role} source changed in ${record.owner}`);
}

function collapseSubtrees(values: ReadonlySet<PluginId>): readonly PluginId[] {
  const sorted = [...values].sort((left, right) => left.length - right.length);
  const result: PluginId[] = [];
  for (const candidate of sorted) {
    if (!result.some((root) => isWithin(candidate, root))) result.push(candidate);
  }
  return result;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}
