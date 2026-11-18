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
 *    style (`1.2.3`, `^1.2.3`, `~1.2.3`), and reinstalls once (`--no-frozen-lockfile`: the
 *    lockfile changes on purpose, also with `CI` set) so the lockfile follows.
 *
 * Only a pnpm project syncs (other managers do not read these overrides). pnpm-workspace.yaml is
 * edited as text, so everything but the version numbers stays byte for byte. A requested
 * `@zhin.js/x@ver` that a synced override would pin back to another version (the one `zhin.js`
 * requires) fails the update instead of reporting success; after the reinstall every requested
 * exact version is checked against what is installed.
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
import { isMap, isScalar, parseDocument, Scalar, type Pair, type YAMLMap } from 'yaml';

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

/**
 * 1-based line of `key` directly inside `pnpm.overrides` of a package.json text: a top-level npm
 * `overrides`, or an `overrides` nested anywhere else, is not it.
 */
function packageJsonOverrideLine(text: string, key: string): number | undefined {
  const frames: { readonly object: boolean; readonly name: string; awaitsKey: boolean }[] = [];
  let lastKey = '';
  let line = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const top = frames.at(-1);
    if (char === '\n') line += 1;
    else if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (top?.object && top.awaitsKey) {
        let name: unknown;
        try { name = JSON.parse(text.slice(index, end + 1)); } catch { return undefined; }
        if (frames.length === 3 && frames[1]!.name === 'pnpm' && frames[2]!.name === 'overrides' && name === key) return line;
        lastKey = String(name);
        top.awaitsKey = false;
      }
      index = end;
    } else if (char === '{' || char === '[') {
      // A container that is the value of a key is named after that key.
      frames.push({ object: char === '{', name: top?.object ? lastKey : '', awaitsKey: char === '{' });
      lastKey = '';
    } else if (char === '}' || char === ']') frames.pop();
    else if (char === ',' && top?.object) top.awaitsKey = true;
  }
  return undefined;
}

function readText(file: string): string | undefined {
  try { return readFileSync(file, 'utf8'); } catch { return undefined; }
}

interface OverrideValues {
  readonly values: Record<string, unknown>;
  /** 1-based line of each key, when known. */
  readonly lines: Record<string, number>;
}

function packageJsonOverrides(text: string | undefined): OverrideValues | undefined {
  if (text === undefined) return undefined;
  try {
    const overrides = (JSON.parse(text) as { pnpm?: { overrides?: unknown } }).pnpm?.overrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return undefined;
    const lines: Record<string, number> = {};
    for (const key of Object.keys(overrides)) {
      const line = packageJsonOverrideLine(text, key);
      if (line) lines[key] = line;
    }
    return { values: overrides as Record<string, unknown>, lines };
  } catch { return undefined; }
}

function yamlOverrides(text: string | undefined): OverrideValues | undefined {
  if (text === undefined) return undefined;
  const doc = parseDocument(text);
  if (doc.errors.length) return undefined;
  const node = doc.get('overrides', true);
  if (!isMap(node)) return undefined;
  const values: Record<string, unknown> = {};
  const lines: Record<string, number> = {};
  for (const item of node.items) {
    const key = isScalar(item.key) ? String(item.key.value) : String(item.key);
    values[key] = isScalar(item.value) ? item.value.value : item.value === null ? null : (item.value as { toJSON?: () => unknown }).toJSON?.();
    const offset = isScalar(item.key) ? item.key.range?.[0] : undefined;
    if (offset !== undefined) lines[key] = text.slice(0, offset).split('\n').length;
  }
  return { values, lines };
}

/** The Zhin entries of the project's pnpm overrides (both files), classified. */
export function readZhinOverrides(root: string): ZhinOverridePlan {
  const entries: ZhinOverrideEntry[] = [];
  const order: Record<ZhinOverrideFile, string[]> = { 'package.json': [], 'pnpm-workspace.yaml': [] };
  for (const file of ['package.json', 'pnpm-workspace.yaml'] as const) {
    const text = readText(join(root, file));
    const overrides = file === 'package.json' ? packageJsonOverrides(text) : yamlOverrides(text);
    if (!overrides) continue;
    order[file] = Object.keys(overrides.values);
    for (const [key, value] of Object.entries(overrides.values)) {
      const classified = classifyZhinOverride(key, value);
      if (classified.kind === 'ignore') continue;
      const line = overrides.lines[key];
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

/** Writes `values` (key → value, `undefined` removes) into `package.json#pnpm.overrides`, keeping key order `order`. */
async function writePackageJsonOverrides(root: string, values: ReadonlyMap<string, string | undefined>, order: readonly string[]): Promise<void> {
  if (values.size === 0) return;
  const path = join(root, 'package.json');
  const text = await readFile(path, 'utf8');
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
}

/**
 * pnpm-workspace.yaml is edited as text at the parsed node ranges, never re-serialized: quoting,
 * comments, flow sequences, indentation and every other entry stay byte for byte. A released entry
 * is cut out with the blank and comment lines directly above it and put back unchanged (but for its version)
 * after the entry that preceded it.
 */
interface ReleasedYamlEntry {
  readonly key: string;
  /** The entry's lines as they were (leading comment lines, key, value, line comment). */
  readonly text: string;
  /** The entry before it in the original map (`undefined`: it was first). */
  readonly after?: string;
}

interface YamlOverridesMap {
  readonly doc: ReturnType<typeof parseDocument>;
  /** The `overrides` value node (undefined when empty / missing). */
  readonly map?: YAMLMap;
  /** Offset of the end of the `overrides:` key line. */
  readonly keyLineEnd?: number;
}

function parseYamlOverrides(text: string): YamlOverridesMap | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length || !isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find(item => isScalar(item.key) && item.key.value === 'overrides');
  if (!pair) return { doc };
  const keyEnd = isScalar(pair.key) ? pair.key.range?.[1] : undefined;
  const keyLineEnd = keyEnd === undefined ? undefined : lineEnd(text, keyEnd);
  return { doc, ...(isMap(pair.value) ? { map: pair.value } : {}), ...(keyLineEnd === undefined ? {} : { keyLineEnd }) };
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Offset just after the newline ending the line at `offset` (or the end of the text). */
function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf('\n', offset);
  return newline < 0 ? text.length : newline + 1;
}

function pairKey(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

/** [start, end) of a block-map entry: the blank and comment lines directly above it through its line end. */
function entrySpan(text: string, pair: Pair): readonly [number, number] | undefined {
  const keyStart = isScalar(pair.key) ? pair.key.range?.[0] : undefined;
  const valueEnd = isScalar(pair.value) ? pair.value.range?.[1] : undefined;
  if (keyStart === undefined || valueEnd === undefined) return undefined;
  let start = lineStart(text, keyStart);
  const indent = text.slice(start, keyStart);
  if (indent.trim() !== '') return undefined;
  // Comment lines directly above, then the blank lines that separate them from the entry before.
  let comments = true;
  while (start > 0) {
    const previous = lineStart(text, start - 1);
    const line = text.slice(previous, start - 1);
    if (comments && line.startsWith(`${indent}#`)) { start = previous; continue; }
    if (line.trim() !== '') break;
    comments = false;
    start = previous;
  }
  return [start, lineEnd(text, valueEnd)];
}

/** `value` written in the quoting style of `scalar`. */
function scalarSource(scalar: Scalar, value: string): string {
  if (scalar.type === Scalar.QUOTE_SINGLE) return `'${value.replaceAll("'", "''")}'`;
  if (scalar.type === Scalar.QUOTE_DOUBLE) return JSON.stringify(value);
  return value;
}

/** Cuts `keys` out of the overrides map; `undefined` when the file has to be re-serialized instead. */
function releaseYamlText(text: string, keys: ReadonlySet<string>): { readonly text: string; readonly released: readonly ReleasedYamlEntry[] } | undefined {
  const parsed = parseYamlOverrides(text);
  if (!parsed?.map || parsed.map.flow) return undefined;
  const spans: { start: number; end: number; entry: ReleasedYamlEntry }[] = [];
  let after: string | undefined;
  for (const pair of parsed.map.items) {
    const key = pairKey(pair);
    if (keys.has(key)) {
      const span = entrySpan(text, pair);
      if (!span) return undefined;
      spans.push({ start: span[0], end: span[1], entry: { key, text: text.slice(span[0], span[1]), ...(after === undefined ? {} : { after }) } });
    }
    after = key;
  }
  let next = text;
  for (const span of [...spans].reverse()) next = next.slice(0, span.start) + next.slice(span.end);
  return { text: next, released: spans.map(span => span.entry) };
}

/** Puts a released entry back after the entry that preceded it (first in the map when none). */
function restoreYamlEntry(text: string, entry: ReleasedYamlEntry): string {
  const parsed = parseYamlOverrides(text);
  const items = parsed?.map && !parsed.map.flow ? parsed.map.items : [];
  const withNewline = entry.text.endsWith('\n') ? entry.text : `${entry.text}\n`;
  const insertAt = (offset: number): string => {
    const head = text.slice(0, offset);
    return `${head}${head.length && !head.endsWith('\n') ? '\n' : ''}${withNewline}${text.slice(offset)}`;
  };
  const previous = entry.after === undefined ? undefined : items.find(pair => pairKey(pair) === entry.after);
  const previousSpan = previous ? entrySpan(text, previous) : undefined;
  if (previousSpan) return insertAt(previousSpan[1]);
  const first = items[0] ? entrySpan(text, items[0]) : undefined;
  if (entry.after === undefined && first) return insertAt(first[0]);
  const last = items.at(-1) ? entrySpan(text, items.at(-1)!) : undefined;
  if (last) return insertAt(last[1]);
  if (parsed?.keyLineEnd !== undefined && !parsed.map) {
    // The map was emptied by the release: the entry goes right under `overrides:`.
    return insertAt(parsed.keyLineEnd);
  }
  return `${text}${text.length && !text.endsWith('\n') ? '\n' : ''}overrides:\n${withNewline}`;
}

/** Replaces the value of an existing plain-scalar entry in place; `undefined` when there is none. */
function setYamlValue(text: string, key: string, value: string): string | undefined {
  const parsed = parseYamlOverrides(text);
  const pair = parsed?.map?.items.find(item => pairKey(item) === key);
  if (!pair || !isScalar(pair.value) || !pair.value.range) return undefined;
  const [start, end] = pair.value.range;
  return text.slice(0, start) + scalarSource(pair.value, value) + text.slice(end);
}

/** Adds `key: value` after the last entry of a block overrides map, in its indentation. */
function appendYamlEntry(text: string, key: string, value: string): string | undefined {
  const parsed = parseYamlOverrides(text);
  const last = parsed?.map && !parsed.map.flow ? parsed.map.items.at(-1) : undefined;
  const span = last ? entrySpan(text, last) : undefined;
  const keyStart = last && isScalar(last.key) ? last.key.range?.[0] : undefined;
  if (!span || keyStart === undefined) return undefined;
  const indent = text.slice(lineStart(text, keyStart), keyStart);
  const source = /^[A-Za-z0-9._-]+$/u.test(key) ? key : `'${key.replaceAll("'", "''")}'`;
  const head = text.slice(0, span[1]);
  return `${head}${head.endsWith('\n') ? '' : '\n'}${indent}${source}: ${value}\n${text.slice(span[1])}`;
}

/** Re-serializes the overrides map (flow maps and entries the text edits cannot place). */
function writeYamlByDocument(text: string, values: ReadonlyMap<string, string | undefined>): string {
  const doc = parseDocument(text);
  const node = doc.get('overrides', true);
  if (!isMap(node)) return text;
  for (const [key, value] of values) {
    if (value === undefined) { node.delete(key); continue; }
    const pair = node.items.find(item => pairKey(item) === key);
    if (pair && isScalar(pair.value)) pair.value.value = value;
    else node.set(key, value);
  }
  return doc.toString({ lineWidth: 0 });
}

/** What {@link releaseZhinOverrides} took out, for {@link pinZhinOverrides} to put back. */
export interface ZhinOverrideRelease {
  readonly yaml: readonly ReleasedYamlEntry[];
}

/** Step 1: removes the syncable Zhin overrides so the package manager can move those packages. */
export async function releaseZhinOverrides(root: string, plan: ZhinOverridePlan): Promise<ZhinOverrideRelease> {
  const synced = (file: ZhinOverrideFile) => plan.entries.filter(entry => entry.file === file && entry.class.kind === 'sync').map(entry => entry.key);
  await writePackageJsonOverrides(root, new Map(synced('package.json').map(key => [key, undefined])), plan.order['package.json']);
  const keys = new Set(synced('pnpm-workspace.yaml'));
  if (keys.size === 0) return { yaml: [] };
  const path = join(root, 'pnpm-workspace.yaml');
  const text = await readFile(path, 'utf8');
  const cut = releaseYamlText(text, keys);
  if (cut) {
    await writeFile(path, cut.text);
    return { yaml: cut.released };
  }
  await writeFile(path, writeYamlByDocument(text, new Map([...keys].map(key => [key, undefined]))));
  return { yaml: [] };
}

async function pinYamlOverrides(root: string, values: ReadonlyMap<string, string>, release: ZhinOverrideRelease | undefined): Promise<void> {
  const path = join(root, 'pnpm-workspace.yaml');
  let text = await readFile(path, 'utf8');
  for (const entry of release?.yaml ?? []) {
    if (values.has(entry.key) && setYamlValue(text, entry.key, values.get(entry.key)!) === undefined) text = restoreYamlEntry(text, entry);
  }
  const fallback = new Map<string, string>();
  for (const [key, value] of values) {
    const next = setYamlValue(text, key, value) ?? appendYamlEntry(text, key, value);
    if (next === undefined) fallback.set(key, value);
    else text = next;
  }
  await writeFile(path, fallback.size ? writeYamlByDocument(text, fallback) : text);
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

/** A package the user asked for at an exact version (`zhin update name@x.y.z`). */
export interface ZhinRequestedVersion {
  readonly name: string;
  readonly version: string;
}

/**
 * The update asked for `name@version`, but a synced override would pin `name` to another version
 * (the one the installed `zhin.js` release requires): the request cannot hold, nothing is pinned.
 */
export class ZhinOverrideConflictError extends Error {
  constructor(readonly requested: ZhinRequestedVersion, readonly entry: ZhinOverrideEntry, readonly pinned: string) {
    const where = `${entry.file}${entry.line ? `:${entry.line}` : ''}`;
    const decider = entry.class.kind === 'sync' && entry.class.parent ? entry.class.parent : 'zhin.js';
    super(`${requested.name}@${requested.version} 无法单独升级：${overrideLocation(entry.file)} "${entry.key}" 会把它钉回 ${pinned}`
      + `——这个包的版本由 ${decider} 的版本决定（已安装的 ${decider} 依赖 ${requested.name}@${pinned}），请改为升级 ${decider}（zhin update ${decider} 或 zhin update ${decider}@<版本>）。`
      + `确实要单独固定它时，手动把 ${where} 的 "${entry.key}" 改成 ${JSON.stringify(syncedOverrideValue(entry, requested.version))}，再运行 pnpm install。`);
    this.name = 'ZhinOverrideConflictError';
  }
}

export interface PinZhinOverridesOptions {
  /** What {@link releaseZhinOverrides} took out (pnpm-workspace.yaml entries go back verbatim). */
  readonly release?: ZhinOverrideRelease;
  /** Exact versions the user asked for: an override pinning one of them elsewhere is a conflict. */
  readonly requested?: readonly ZhinRequestedVersion[];
}

/**
 * Step 2: pins the released overrides to the installed versions (the old value when none is
 * found). Throws {@link ZhinOverrideConflictError}, before writing, when a pin would move a package
 * the user asked for at an exact version.
 */
export async function pinZhinOverrides(root: string, plan: ZhinOverridePlan, options: PinZhinOverridesOptions = {}): Promise<ZhinOverrideSyncResult> {
  const changes: ZhinOverrideChange[] = [];
  const manual: string[] = [];
  const values: Record<ZhinOverrideFile, Map<string, string>> = { 'package.json': new Map(), 'pnpm-workspace.yaml': new Map() };
  for (const entry of plan.entries) {
    if (entry.class.kind === 'manual') { manual.push(manualOverrideHint(entry)); continue; }
    const from = String(entry.value);
    const version = installedOverrideTarget(root, entry);
    const requested = options.requested?.find(item => item.name === entry.class.name);
    if (requested && entry.class.name !== 'zhin.js' && version !== undefined && version !== requested.version) throw new ZhinOverrideConflictError(requested, entry, version);
    if (!version) { values[entry.file].set(entry.key, from); manual.push(manualOverrideHint(entry)); continue; }
    const to = syncedOverrideValue(entry, version);
    values[entry.file].set(entry.key, to);
    if (to !== from) changes.push({ file: entry.file, key: entry.key, from, to });
  }
  let written = false;
  if (values['package.json'].size) { await writePackageJsonOverrides(root, values['package.json'], plan.order['package.json']); written = true; }
  if (values['pnpm-workspace.yaml'].size) { await pinYamlOverrides(root, values['pnpm-workspace.yaml'], options.release); written = true; }
  return { changes, manual, written };
}

/** Readable lines of a sync (transaction output and dry-run). */
export function formatOverrideChanges(changes: readonly ZhinOverrideChange[]): string[] {
  return changes.map(change => `${overrideLocation(change.file)} "${change.key}": ${change.from} → ${change.to}`);
}
