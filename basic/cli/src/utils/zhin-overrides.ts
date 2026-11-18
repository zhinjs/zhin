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
