import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSourcePath } from './source-path.js';

/**
 * `package.json` fields that can change what the Runtime loads or how it resolves modules
 * (#1250). A change of any other field (`scripts`, `description`, `keywords`, `repository`, ...)
 * is ignored by file watching: it neither reloads nor restarts the instance. `version` counts only
 * for mounted child Plugin packages ({@link PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS}); the Root
 * project's own `version` stays ignored.
 *
 * Nested fields are written with a dot (`pnpm.overrides`); `pnpm.*` is compared per key so only
 * install-affecting pnpm settings count.
 */
export const RUNTIME_MANIFEST_FIELDS: readonly string[] = Object.freeze([
  // Installed dependency set (and the versions that resolve).
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'bundleDependencies', 'bundledDependencies', 'dependenciesMeta', 'peerDependenciesMeta',
  'overrides', 'resolutions', 'pnpm.overrides', 'pnpm.patchedDependencies',
  'pnpm.packageExtensions', 'pnpm.peerDependencyRules', 'workspaces', 'engines',
  // Package identity and module resolution (RestartBoundaryPlanner's runtime ABI).
  'name', 'type', 'main', 'module', 'exports', 'imports',
  // Plugin / Feature manifest.
  'zhin',
]);

/**
 * Extra runtime fields of a mounted child Plugin's `package.json`: the committed Plugin tree
 * records its `version` (`packageVersion`), which the gateway compares for schema drift and
 * published state (#1250).
 */
export const PLUGIN_PACKAGE_RUNTIME_MANIFEST_FIELDS: readonly string[] = Object.freeze(['version']);

const runtimeFields = new Set(RUNTIME_MANIFEST_FIELDS);

export interface ManifestFieldChange {
  /** Normalized path of the `package.json`. */
  readonly source: string;
  /** Every changed field (top level, `pnpm.<key>` for pnpm settings); `<unparseable>` for invalid JSON. */
  readonly fields: readonly string[];
  /** The subset of {@link fields} that can affect the Runtime. */
  readonly runtimeFields: readonly string[];
}

export function isRuntimeManifestField(field: string, extraFields: readonly string[] = []): boolean {
  return runtimeFields.has(field) || field === UNPARSEABLE || extraFields.includes(field);
}

const UNPARSEABLE = '<unparseable>';

/** Changed fields between two parsed manifests, sorted. */
export function changedManifestFields(previous: unknown, next: unknown): readonly string[] {
  const before = asRecord(previous);
  const after = asRecord(next);
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    if (key === 'pnpm') {
      const left = asRecord(before[key]);
      const right = asRecord(after[key]);
      for (const nested of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!isDeepStrictEqual(left[nested], right[nested])) changed.add(`pnpm.${nested}`);
      }
      continue;
    }
    changed.add(key);
  }
  return Object.freeze([...changed].sort());
}

/** Baselines of some manifests at one moment, to put back when a reload does not commit. */
export interface ManifestBaselineCheckpoint {
  readonly entries: ReadonlyMap<string, { readonly present: boolean; readonly value?: unknown }>;
}

/**
 * Remembers the last seen content of watched `package.json` files so a watch event can say which
 * fields changed. Without a baseline (a manifest seen for the first time) nothing is known and
 * the caller keeps its normal handling.
 */
export class ManifestChangeTracker {
  readonly #contents = new Map<string, unknown>();

  constructor(private readonly read: (source: string) => string = (source) => readFileSync(source, 'utf8')) {}

  /**
   * Records a baseline for manifests that do not have one yet. Missing / invalid files are skipped,
   * and so are sources for which `skip` is true (e.g. an event for them is still queued: adopting
   * the file now would hide that edit).
   */
  prime(sources: Iterable<string>, skip?: (source: string) => boolean): void {
    for (const source of sources) {
      const normalized = normalizeSourcePath(source);
      if (this.#contents.has(normalized) || skip?.(normalized)) continue;
      const parsed = this.#parse(normalized);
      if (parsed.ok) this.#contents.set(normalized, parsed.value);
    }
  }

  /** The current baselines of the sources, for {@link restore}. */
  checkpoint(sources: Iterable<string>): ManifestBaselineCheckpoint {
    const entries = new Map<string, { readonly present: boolean; readonly value?: unknown }>();
    for (const source of sources) {
      const normalized = normalizeSourcePath(source);
      entries.set(normalized, this.#contents.has(normalized)
        ? { present: true, value: this.#contents.get(normalized) }
        : { present: false });
    }
    return Object.freeze({ entries });
  }

  /** Puts back the baselines of a checkpoint (a reload that compared against them did not commit). */
  restore(checkpoint: ManifestBaselineCheckpoint): void {
    for (const [source, entry] of checkpoint.entries) {
      if (entry.present) this.#contents.set(source, entry.value);
      else this.#contents.delete(source);
    }
  }

  /**
   * Compares the file on disk with the baseline and adopts it as the new baseline. `undefined`
   * when there was no baseline (or the file is gone), i.e. the change cannot be classified.
   * `extraRuntimeFields` are runtime fields for this manifest only (e.g. a child Plugin's `version`).
   */
  diff(source: string, extraRuntimeFields: readonly string[] = []): ManifestFieldChange | undefined {
    const normalized = normalizeSourcePath(source);
    const hasBaseline = this.#contents.has(normalized);
    const previous = this.#contents.get(normalized);
    const parsed = this.#parse(normalized);
    const missing = !parsed.ok && parsed.missing;
    if (parsed.ok) this.#contents.set(normalized, parsed.value);
    else if (missing) this.#contents.delete(normalized);
    if (!hasBaseline || missing) return undefined;
    const fields = parsed.ok ? changedManifestFields(previous, parsed.value) : Object.freeze([UNPARSEABLE]);
    return Object.freeze({
      source: normalized,
      fields,
      runtimeFields: Object.freeze(fields.filter((field) => isRuntimeManifestField(field, extraRuntimeFields))),
    });
  }

  #parse(source: string): { ok: true; value: unknown } | { ok: false; missing: boolean } {
    let text: string;
    try { text = this.read(source); } catch { return { ok: false, missing: true }; }
    try { return { ok: true, value: JSON.parse(text) as unknown }; } catch { return { ok: false, missing: false }; }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
