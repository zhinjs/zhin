/**
 * #1250 update-overrides-not-synced, `zhin update --dry-run` side: which pnpm overrides pin Zhin
 * packages and how `zhin update` treats them. The update itself runs in the gateway
 * (`packages/host/gateway/src/plugin-management/zhin-overrides.ts`), which releases these entries
 * before the package manager and pins them to the installed versions afterwards. The gateway keeps
 * that module internal (no new public export), so the classification and messages are mirrored
 * here; `tests/utils/zhin-overrides-parity.test.ts` keeps both copies identical.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlias, isMap, isScalar, parseDocument, Scalar, visit } from 'yaml';

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
  /** Keys whose YAML form the text edits cannot release and put back safely, and why. */
  readonly unsafeForms?: Record<string, string>;
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
  // Anchors some alias refers to: cutting the anchored entry out would leave that alias dangling.
  const referenced = new Set<string>();
  visit(doc, { Alias(_, alias) { referenced.add(alias.source); } });
  const values: Record<string, unknown> = {};
  const lines: Record<string, number> = {};
  const unsafeForms: Record<string, string> = {};
  for (const item of node.items) {
    const key = isScalar(item.key) ? String(item.key.value) : String(item.key);
    values[key] = isScalar(item.value) ? item.value.value : item.value === null ? null : (item.value as { toJSON?: () => unknown }).toJSON?.();
    const offset = isScalar(item.key) ? item.key.range?.[0] : undefined;
    if (offset !== undefined) lines[key] = text.slice(0, offset).split('\n').length;
    // Only one-line plain or quoted scalars are released and put back as text (#1250 第 56 批).
    if (isAlias(item.value)) {
      values[key] = `*${item.value.source}`;
      unsafeForms[key] = `值是 YAML 别名（*${item.value.source}），无法自动同步`;
    } else if (isScalar(item.value) && (item.value.type === Scalar.BLOCK_FOLDED || item.value.type === Scalar.BLOCK_LITERAL)) {
      unsafeForms[key] = '值是 YAML 块标量（> / |），无法自动同步';
    } else if (isScalar(item.value) && item.value.anchor && referenced.has(item.value.anchor)) {
      unsafeForms[key] = `值带锚点（&${item.value.anchor}）且被别处引用，无法自动同步`;
    }
  }
  return { values, lines, unsafeForms };
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
      const unsafe = overrides.unsafeForms?.[key];
      if (unsafe) {
        const line = overrides.lines[key];
        entries.push({ file, key, value, ...(line ? { line } : {}), class: { kind: 'manual', name: classified.name, reason: unsafe } });
        continue;
      }
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

export interface ZhinOverrideChange {
  readonly file: ZhinOverrideFile;
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

/** Readable lines of a sync (transaction output and dry-run). */
export function formatOverrideChanges(changes: readonly ZhinOverrideChange[]): string[] {
  return changes.map(change => `${overrideLocation(change.file)} "${change.key}": ${change.from} → ${change.to}`);
}
