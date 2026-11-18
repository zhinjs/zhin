/**
 * #1250 update-overrides-not-synced: projects pin their Zhin packages with pnpm overrides so that
 * every `zhin.js` / `@zhin.js/*` package resolves to one copy. A `zhin update` that left those
 * overrides on the old versions either did nothing (the override keeps the old version) or, for an
 * exact `name@x.y.z`, installed the new package next to old overridden dependencies — two copies,
 * and `zhin doctor`'s 「Zhin 包单实例」 check fails.
 *
 * The update transaction therefore
 * 1. releases the Zhin overrides it can sync (removes them) before the package manager runs, so
 *    the update resolves the new versions;
 * 2. pins them again afterwards to the versions now installed — the exact dependency of the
 *    installed `zhin.js` (one release's aligned set), else the installed copy — keeping each value's
 *    style (`1.2.3`, `^1.2.3`, `~1.2.3`), and reinstalls once so the lockfile follows.
 *
 * Both happen inside the transaction (package.json and pnpm-workspace.yaml are in its snapshot),
 * so a failure rolls them back with everything else. Non-Zhin entries are never touched; entries
 * whose form cannot be synced automatically are listed with their file and line to edit by hand.
 *
 * Supported: `name` keys and `parent>name` keys (one parent, no version selector) in
 * `package.json#pnpm.overrides` and `pnpm-workspace.yaml#overrides`, with an exact version or a
 * `^` / `~` version. Local wiring (`link:`, `file:`, `workspace:`, `$ref`, `npm:` …) is the
 * user's own and is left alone.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';

export type ZhinOverrideFile = 'package.json' | 'pnpm-workspace.yaml';

/** Where an override is written, for messages: `package.json 的 pnpm.overrides`. */
export function overrideLocation(file: ZhinOverrideFile): string {
  return file === 'package.json' ? 'package.json 的 pnpm.overrides' : 'pnpm-workspace.yaml 的 overrides';
}

export type ZhinOverrideClass =
  /** Not a Zhin package, or the user's own local wiring: left alone. */
  | { readonly kind: 'ignore' }
  | {
    readonly kind: 'sync';
    /** The overridden Zhin package. */
    readonly name: string;
    /** `parent>name`: the package whose dependency is overridden. */
    readonly parent?: string;
    /** `''` (exact), `^` or `~`: kept when the version changes. */
    readonly prefix: '' | '^' | '~';
  }
  | { readonly kind: 'manual'; readonly name: string; readonly reason: string };

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const LOCAL_VALUE = /^(?:link:|file:|workspace:|portal:|catalog:|npm:|git\+|git:|github:|https?:|\$|\.{0,2}\/|-$)/u;

export function isZhinPackageName(name: string): boolean {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

/** `@scope/name@range` → name and the selector after it. */
function splitSelector(segment: string): { readonly name: string; readonly selector?: string } {
  const at = segment.indexOf('@', segment.startsWith('@') ? 1 : 0);
  return at > 0 ? { name: segment.slice(0, at), selector: segment.slice(at + 1) } : { name: segment };
}

/** How one override entry takes part in a Zhin update. */
export function classifyZhinOverride(key: string, value: unknown): ZhinOverrideClass {
  const segments = key.split('>').map(segment => segment.trim());
  const target = splitSelector(segments.at(-1)!);
  if (!isZhinPackageName(target.name)) return { kind: 'ignore' };
  if (typeof value !== 'string') return { kind: 'manual', name: target.name, reason: '值不是版本字符串（嵌套对象写法），无法自动同步' };
  const raw = value.trim();
  if (LOCAL_VALUE.test(raw)) return { kind: 'ignore' };
  if (target.selector !== undefined) return { kind: 'manual', name: target.name, reason: `键带版本选择器（${target.name}@${target.selector}），升级后可能不再匹配` };
  if (segments.length > 2) return { kind: 'manual', name: target.name, reason: '多级 > 选择器，无法自动同步' };
  const parent = segments.length === 2 ? splitSelector(segments[0]!) : undefined;
  if (parent?.selector !== undefined) return { kind: 'manual', name: target.name, reason: `父包带版本选择器（${segments[0]}），升级后可能不再匹配` };
  const prefix = raw.startsWith('^') ? '^' : raw.startsWith('~') ? '~' : '';
  const version = raw.slice(prefix.length).replace(/^=?v?/u, '');
  if (!EXACT.test(version)) return { kind: 'manual', name: target.name, reason: `版本范围「${raw}」无法自动同步，只支持精确版本或 ^ / ~ 版本` };
  return { kind: 'sync', name: target.name, ...(parent ? { parent: parent.name } : {}), prefix };
}

export interface ZhinOverrideEntry {
  readonly file: ZhinOverrideFile;
  readonly key: string;
  readonly value: unknown;
  /** 1-based line of the key in its file (undefined when it cannot be found). */
  readonly line?: number;
  readonly class: Exclude<ZhinOverrideClass, { kind: 'ignore' }>;
}

export interface ZhinOverridePlan {
  readonly entries: readonly ZhinOverrideEntry[];
  /** Key order of each file's overrides before the update (kept when pinning again). */
  readonly order: Readonly<Record<ZhinOverrideFile, readonly string[]>>;
}

function lineOf(text: string, key: string, quoted: boolean): number | undefined {
  const lines = text.split('\n');
  const start = Math.max(0, lines.findIndex(line => /^\s*"?overrides"?\s*:/u.test(line)));
  const needles = quoted ? [JSON.stringify(key)] : [`'${key}'`, `"${key}"`, key];
  for (let index = start; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trimStart();
    if (needles.some(needle => trimmed.startsWith(`${needle}:`) || trimmed.startsWith(`${needle} :`))) return index + 1;
  }
  return undefined;
}

function readText(file: string): string | undefined {
  try { return readFileSync(file, 'utf8'); } catch { return undefined; }
}

function packageJsonOverrides(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const overrides = (JSON.parse(text) as { pnpm?: { overrides?: unknown } }).pnpm?.overrides;
    return overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function yamlOverrides(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  const doc = parseDocument(text);
  if (doc.errors.length) return undefined;
  const node = doc.get('overrides', true);
  if (!isMap(node)) return undefined;
  const values: Record<string, unknown> = {};
  for (const item of node.items) {
    const key = isScalar(item.key) ? String(item.key.value) : String(item.key);
    values[key] = isScalar(item.value) ? item.value.value : item.value === null ? null : (item.value as { toJSON?: () => unknown }).toJSON?.();
  }
  return values;
}

/** The Zhin entries of the project's pnpm overrides (both files), classified. */
export function readZhinOverrides(root: string): ZhinOverridePlan {
  const entries: ZhinOverrideEntry[] = [];
  const order: Record<ZhinOverrideFile, string[]> = { 'package.json': [], 'pnpm-workspace.yaml': [] };
  for (const file of ['package.json', 'pnpm-workspace.yaml'] as const) {
    const text = readText(join(root, file));
    const overrides = file === 'package.json' ? packageJsonOverrides(text) : yamlOverrides(text);
    if (!overrides) continue;
    order[file] = Object.keys(overrides);
    for (const [key, value] of Object.entries(overrides)) {
      const classified = classifyZhinOverride(key, value);
      if (classified.kind === 'ignore') continue;
      const line = lineOf(text!, key, file === 'package.json');
      entries.push({ file, key, value, ...(line ? { line } : {}), class: classified });
    }
  }
  return { entries, order };
}

/** The line telling which override to edit by hand, and why. */
export function manualOverrideHint(entry: ZhinOverrideEntry): string {
  const where = `${entry.file}${entry.line ? `:${entry.line}` : ''}`;
  const reason = entry.class.kind === 'manual' ? entry.class.reason : '无法确定升级后的版本';
  return `请手动修改 ${where}（${overrideLocation(entry.file)}）"${entry.key}": ${JSON.stringify(entry.value)}——${reason}；改成与升级后的 ${entry.class.name} 相同的版本，再运行 pnpm install`;
}

/** The new value of a synced override: the same style around `version`. */
export function syncedOverrideValue(entry: ZhinOverrideEntry, version: string): string {
  return `${entry.class.kind === 'sync' ? entry.class.prefix : ''}${version}`;
}

interface Manifest {
  readonly version?: unknown;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

function readManifest(dir: string): Manifest | undefined {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest; } catch { return undefined; }
}

/** `name` as Node resolves it from `fromDir` (realpath), skipping pnpm's hidden hoist. */
function resolvePackageDir(fromDir: string, name: string): string | undefined {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    if (basename(dir) !== 'node_modules' && basename(dir) !== '.pnpm') {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function exactDependency(manifest: Manifest | undefined, name: string): string | undefined {
  for (const field of [manifest?.dependencies, manifest?.optionalDependencies, manifest?.peerDependencies]) {
    const spec = field?.[name];
    if (typeof spec === 'string' && EXACT.test(spec.trim().replace(/^=?v?/u, ''))) return spec.trim().replace(/^=?v?/u, '');
  }
  return undefined;
}

/**
 * The version an override for `entry` should pin after the update, read from the installed tree:
 * for `parent>name` the parent's exact dependency (else the copy the parent resolves). For `name`
 * the first exact dependency on it met walking the Zhin packages breadth-first from the installed
 * `zhin.js` (one release's aligned set), then from the project's other Zhin dependencies; else the
 * project's own copy. `zhin.js` itself pins the installed `zhin.js`.
 */
export function installedOverrideTarget(root: string, entry: ZhinOverrideEntry): string | undefined {
  if (entry.class.kind !== 'sync') return undefined;
  const { name, parent } = entry.class;
  const projectReal = realpathSync(root);
  const versionAt = (dir: string | undefined): string | undefined => {
    const version = dir ? readManifest(dir)?.version : undefined;
    return typeof version === 'string' ? version : undefined;
  };
  if (parent) {
    const parentDir = resolvePackageDir(projectReal, parent);
    if (!parentDir) return undefined;
    return exactDependency(readManifest(parentDir), name) ?? versionAt(resolvePackageDir(parentDir, name));
  }
  if (name !== 'zhin.js') {
    const project = readManifest(projectReal);
    const others = Object.keys({ ...project?.dependencies, ...(project as { devDependencies?: object } | undefined)?.devDependencies })
      .filter(dep => dep !== 'zhin.js' && dep !== name && isZhinPackageName(dep));
    // zhin.js's release first; the project's other Zhin dependencies only when it says nothing.
    for (const starts of [['zhin.js'], others]) {
      const queue = starts.map(dep => resolvePackageDir(projectReal, dep)).filter((dir): dir is string => dir !== undefined);
      const seen = new Set<string>(queue);
      while (queue.length) {
        const dir = queue.shift()!;
        const manifest = readManifest(dir);
        const aligned = exactDependency(manifest, name);
        if (aligned) return aligned;
        for (const dep of Object.keys({ ...manifest?.dependencies, ...manifest?.optionalDependencies })) {
          if (!isZhinPackageName(dep)) continue;
          const next = resolvePackageDir(dir, dep);
          if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
    }
  }
  return versionAt(resolvePackageDir(projectReal, name));
}

function detectIndent(text: string): string | number {
  const match = /^[ \t]+(?=")/mu.exec(text);
  return match ? match[0] : 2;
}

/** Writes `values` (key → value, `undefined` removes) into the overrides of `file`, keeping key order `order`. */
async function writeOverrides(
  root: string,
  file: ZhinOverrideFile,
  values: ReadonlyMap<string, string | undefined>,
  order: readonly string[],
): Promise<void> {
  if (values.size === 0) return;
  const path = join(root, file);
  const text = await readFile(path, 'utf8');
  if (file === 'package.json') {
    const manifest = JSON.parse(text) as { pnpm?: { overrides?: Record<string, unknown> } };
    const current = manifest.pnpm?.overrides ?? {};
    const next: Record<string, unknown> = {};
    const keys = [...order, ...Object.keys(current).filter(key => !order.includes(key))];
    for (const key of keys) {
      if (values.has(key)) { const value = values.get(key); if (value !== undefined) next[key] = value; continue; }
      if (key in current) next[key] = current[key];
    }
    manifest.pnpm = { ...manifest.pnpm, overrides: next };
    await writeFile(path, `${JSON.stringify(manifest, null, detectIndent(text))}${text.endsWith('\n') ? '\n' : ''}`);
    return;
  }
  const doc = parseDocument(text);
  const node = doc.get('overrides', true);
  if (!isMap(node)) return;
  for (const [key, value] of values) {
    if (value === undefined) node.delete(key);
    else node.set(key, value);
  }
  // Re-added keys go back to their original position.
  node.items.sort((left, right) => {
    const index = (item: typeof left) => order.indexOf(isScalar(item.key) ? String(item.key.value) : String(item.key));
    const a = index(left), b = index(right);
    return (a < 0 ? Number.MAX_SAFE_INTEGER : a) - (b < 0 ? Number.MAX_SAFE_INTEGER : b);
  });
  await writeFile(path, doc.toString({ lineWidth: 0 }));
}

/** Step 1: removes the syncable Zhin overrides so the package manager can move those packages. */
export async function releaseZhinOverrides(root: string, plan: ZhinOverridePlan): Promise<void> {
  for (const file of ['package.json', 'pnpm-workspace.yaml'] as const) {
    const released = new Map(plan.entries.filter(entry => entry.file === file && entry.class.kind === 'sync').map(entry => [entry.key, undefined]));
    await writeOverrides(root, file, released, plan.order[file]);
  }
}

export interface ZhinOverrideChange {
  readonly file: ZhinOverrideFile;
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

export interface ZhinOverrideSyncResult {
  readonly changes: readonly ZhinOverrideChange[];
  /** Entries to edit by hand (not syncable, or no installed version to pin). */
  readonly manual: readonly string[];
  /** Whether a file was written (the lockfile then needs an install). */
  readonly written: boolean;
}

/** Step 2: pins the released overrides to the installed versions (the old value when none is found). */
export async function pinZhinOverrides(root: string, plan: ZhinOverridePlan): Promise<ZhinOverrideSyncResult> {
  const changes: ZhinOverrideChange[] = [];
  const manual: string[] = [];
  let written = false;
  for (const file of ['package.json', 'pnpm-workspace.yaml'] as const) {
    const values = new Map<string, string>();
    for (const entry of plan.entries.filter(item => item.file === file)) {
      if (entry.class.kind === 'manual') { manual.push(manualOverrideHint(entry)); continue; }
      const from = String(entry.value);
      const version = installedOverrideTarget(root, entry);
      if (!version) { values.set(entry.key, from); manual.push(manualOverrideHint(entry)); continue; }
      const to = syncedOverrideValue(entry, version);
      values.set(entry.key, to);
      if (to !== from) changes.push({ file, key: entry.key, from, to });
    }
    if (values.size) { await writeOverrides(root, file, values, plan.order[file]); written = true; }
  }
  return { changes, manual, written };
}

/** Readable lines of a sync (transaction output and dry-run). */
export function formatOverrideChanges(changes: readonly ZhinOverrideChange[]): string[] {
  return changes.map(change => `${overrideLocation(change.file)} "${change.key}": ${change.from} → ${change.to}`);
}
