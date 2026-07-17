import { basename, resolve } from 'node:path';
import type { CapabilityId, PluginId } from '@zhin.js/next-kernel';
import type { SourceOwnershipIndex, SourceOwnershipRecord } from './source-ownership.js';

export interface DependencyImpactPort {
  affectedSources(source: string): readonly string[];
}

export interface NoInvalidationPlan {
  readonly kind: 'none';
  readonly changed: readonly string[];
  readonly reasons: readonly string[];
}

export interface GenerationInvalidationPlan {
  readonly kind: 'generation';
  readonly changed: readonly string[];
  readonly slots: readonly CapabilityId[];
  readonly subtrees: readonly PluginId[];
  readonly reasons: readonly string[];
}

export interface ProcessInvalidationPlan {
  readonly kind: 'process';
  readonly changed: readonly string[];
  readonly reasons: readonly string[];
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
    const changed = unique(sources.map((source) => resolve(source)));
    if (changed.some((source) => processFiles.has(basename(source)))) {
      return Object.freeze({
        kind: 'process',
        changed,
        reasons: Object.freeze(['workspace dependency state changed']),
      });
    }

    const slots = new Map<CapabilityId, PluginId>();
    const subtrees = new Set<PluginId>();
    const reasons = new Set<string>();

    for (const source of changed) {
      const affected = unique(
        [source, ...(this.dependencies?.affectedSources(source) ?? [])].map((item) =>
          resolve(item),
        ),
      );
      let matched = false;
      for (const item of affected) {
        const records = this.ownership.recordsFor(item);
        if (records.length > 0) matched = true;
        for (const record of records) {
          applyRecord(record, slots, subtrees, reasons);
        }
      }

      // An untracked support module still belongs to the nearest mounted
      // package. Without an owned importer, subtree replacement is safest.
      if (!matched) {
        for (const owner of this.ownership.ownersForPath(source)) {
          subtrees.add(owner);
          reasons.add(`untracked support source changed in ${owner}`);
        }
      }
    }

    const roots = collapseSubtrees(subtrees);
    const retainedSlots = [...slots].flatMap(([capability, owner]) =>
      roots.some((root) => isWithin(owner, root)) ? [] : [capability],
    );
    if (roots.length === 0 && retainedSlots.length === 0) {
      return Object.freeze({
        kind: 'none',
        changed,
        reasons: Object.freeze([...reasons]),
      });
    }
    return Object.freeze({
      kind: 'generation',
      changed,
      slots: Object.freeze(retainedSlots),
      subtrees: Object.freeze(roots),
      reasons: Object.freeze([...reasons]),
    });
  }
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

function isWithin(plugin: PluginId, root: PluginId): boolean {
  return plugin === root || plugin.startsWith(`${root}/`);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}
