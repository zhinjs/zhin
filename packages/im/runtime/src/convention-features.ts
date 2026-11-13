/**
 * Convention directory → Feature package inference for `package.json#zhin.features`.
 *
 * This is the single source of truth for which Feature package discovers each convention
 * directory (docs/authoring/conventions.md). The Runtime project graph, `zhin plugin check`,
 * `zhin add` / `zhin new` and the repository dependency-policy scripts all read it from here.
 *
 * The module is dependency-free apart from `node:fs` / `node:path` and uses only erasable
 * TypeScript, so repository `.mjs` scripts can import the source file directly.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** Feature package that discovers each convention directory at a Plugin package root. */
export const CONVENTION_FEATURE_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
  commands: '@zhin.js/command',
  components: '@zhin.js/component',
  middlewares: '@zhin.js/middleware',
  handlers: '@zhin.js/handler',
  schedules: '@zhin.js/schedule-feature',
  tools: '@zhin.js/tool',
  'prompt-sections': '@zhin.js/prompt-section',
  hooks: '@zhin.js/hook-feature',
  mcps: '@zhin.js/mcp-feature',
  adapters: '@zhin.js/adapter',
  skills: '@zhin.js/skill',
  agents: '@zhin.js/agent-feature',
});

/** A Feature reference implied by a convention directory rather than written in `zhin.features`. */
export interface InferredFeatureReference {
  readonly package: string;
  /** The convention directory (relative to the package root) that implied the reference. */
  readonly directory: string;
}

/** The parts of a `zhin` manifest that decide inference; accepts raw or parsed manifests. */
export interface ConventionFeatureManifest {
  readonly type?: unknown;
  readonly runtime?: unknown;
  readonly features?: unknown;
  /** Set by the Runtime parser when the raw manifest omitted `features`. */
  readonly featuresOmitted?: unknown;
}

/** True when `zhin.features` is absent (raw manifest) or recorded as omitted (parsed manifest). */
export function featuresOmitted(manifest: ConventionFeatureManifest): boolean {
  return manifest.features === undefined || manifest.featuresOmitted === true;
}

/**
 * Feature references implied by the convention directories present at `packageRoot`.
 *
 * - Only `type: "plugin"` manifests that omit `zhin.features` infer. A written list, even `[]`,
 *   is authoritative: such a Plugin loads exactly as it did before inference existed.
 * - Isolated Plugins never infer (they cannot mount Host Features; their code runs outside it).
 * - Inferred references carry no `api` range, so the installed Feature version is accepted, and
 *   they are required: an unresolvable one fails like a missing declared Feature.
 */
export function inferConventionFeatureReferences(
  packageRoot: string,
  manifest: ConventionFeatureManifest | undefined,
): readonly InferredFeatureReference[] {
  if (!manifest || manifest.type !== 'plugin' || manifest.runtime === 'isolated' || !featuresOmitted(manifest)) {
    return [];
  }
  const inferred: InferredFeatureReference[] = [];
  for (const [directory, featurePackage] of Object.entries(CONVENTION_FEATURE_PACKAGES)) {
    if (isDirectory(join(packageRoot, directory))) inferred.push(Object.freeze({ package: featurePackage, directory }));
  }
  return Object.freeze(inferred);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
