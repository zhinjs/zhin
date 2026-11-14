/**
 * Structured log records of file watching (#1250): what a hot reload really rebuilt, why the
 * instance restarts, and which `package.json` edits were ignored. Pure functions so the wording
 * is testable without starting an instance.
 */
import { basename, relative } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type {
  GenerationInvalidationPlan,
  HmrReloadReport,
  ManifestFieldChange,
  ProcessInvalidationPlan,
} from '@zhin.js/runtime';

type LogFields = Record<string, string | number | boolean | undefined>;

function readableCapabilityId(value: string): string {
  return value.split('\0').join(':');
}

function display(root: string, source: string): string {
  const path = relative(root, source);
  return path && !path.startsWith('..') ? path.split('\\').join('/') : source;
}

function list(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined;
}

/** Scope the invalidation plan asked for (what `hmr_reload` used to report as `scope`). */
function plannedScope(plan: GenerationInvalidationPlan): 'root' | 'subtree' | 'capability' {
  if (plan.subtrees.includes(rootPluginId())) return 'root';
  return plan.subtrees.length > 0 || plan.manifestSources.length > 0 ? 'subtree' : 'capability';
}

export interface HmrReloadLog {
  readonly info: LogFields;
  /** Set when the reload rebuilt the whole Root generation while the plan asked for less. */
  readonly warn?: LogFields;
}

/**
 * `hmr_reload` record. `scope` stays what the invalidation plan asked for; `rebuilt` and
 * `rebuilt_plugins` say what the committed generation actually set up again (adapters and their
 * Endpoints included).
 */
export function describeHmrReloadLog(
  root: string,
  plan: GenerationInvalidationPlan,
  generation: number,
  durationMs: number,
  report?: HmrReloadReport,
): HmrReloadLog {
  const scope = plannedScope(plan);
  const changed = plan.changed.map((source) => display(root, source));
  const info: LogFields = {
    op: 'hmr_reload',
    generation,
    duration_ms: durationMs,
    scope,
    rebuilt: report?.rebuilt ?? 'none',
    changed: changed.join(','),
    capabilities: list((report?.capabilities.length ? report.capabilities : plan.slots).map(readableCapabilityId)),
    subtrees: list(plan.subtrees),
    rebuilt_plugins: list(report?.plugins ?? []),
  };
  if (report?.rebuilt !== 'root' || scope === 'root') return { info };
  return {
    info,
    warn: {
      op: 'hmr_full_rebuild',
      generation,
      planned: scope,
      reason: report.reason ?? 'unknown',
      changed: changed.join(','),
      rebuilt_plugins: list(report.plugins),
    },
  };
}

/** `instance_restart` record written before file watching asks the gateway for a restart. */
export function describeRestartLog(root: string, plan: ProcessInvalidationPlan): LogFields {
  const manifests = plan.manifestChanges ?? [];
  const changed = plan.changed.map((source) => display(root, source));
  if (manifests.length > 0) {
    return {
      op: 'instance_restart',
      reason: 'manifest_changed',
      file: manifests.map((change) => display(root, change.source)).join(','),
      fields: list([...new Set(manifests.flatMap((change) => change.fields))]),
      runtime_fields: list([...new Set(manifests.flatMap((change) => change.runtimeFields))]),
      changed: changed.join(','),
      detail: plan.reasons.join('; '),
    };
  }
  const lockfile = changed.find((source) => /(?:^|\/)(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock)$/u.test(source));
  return {
    op: 'instance_restart',
    reason: lockfile ? 'dependencies_changed'
      : changed.some((source) => basename(source).startsWith('.env')) ? 'environment_changed'
        : changed.some((source) => basename(source) === 'package.json') ? 'manifest_changed'
          : 'source_requires_restart',
    file: lockfile,
    changed: changed.join(','),
    detail: plan.reasons.join('; '),
  };
}

/** Debug record for a `package.json` edit that file watching ignored. */
export function describeManifestIgnoredLog(root: string, change: ManifestFieldChange): LogFields {
  return {
    op: 'manifest_change_ignored',
    file: display(root, change.source),
    fields: list(change.fields) ?? '(none)',
    reason: 'no runtime-relevant field changed',
  };
}
