/**
 * Static view of a plugin package for `zhin packages info` (#1250): who maintains it, which
 * commands / Agent tools it ships and which config fields it declares. Read from `package.json`,
 * `schema.json` and the convention directories only — no plugin code runs and no IM layer is loaded.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanConventionCapabilityFeatures } from '@zhin.js/runtime';

/** `author` / a `maintainers` entry as npm returns it: `"Name <mail> (url)"` or `{ name, email }`. */
export type PackagePerson = string | { readonly name?: unknown; readonly email?: unknown } | null | undefined;

/** Display name of a package person; `undefined` when it names nobody. */
export function packagePersonName(person: PackagePerson): string | undefined {
  if (typeof person === 'string') {
    const name = person.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim();
    return name || undefined;
  }
  if (person && typeof person === 'object' && typeof person.name === 'string' && person.name.trim()) {
    return person.name.trim();
  }
  return undefined;
}

/** Author, falling back to the maintainers (`npm view` lists them as strings). */
export function packageAuthors(info: Readonly<{ author?: PackagePerson; maintainers?: unknown }>): string[] {
  const author = packagePersonName(info.author);
  if (author) return [author];
  const maintainers = Array.isArray(info.maintainers) ? info.maintainers as PackagePerson[] : [];
  return [...new Set(maintainers.map(packagePersonName).filter((name): name is string => !!name))];
}

/** Names of the manifest `features` (`{ package, api }` entries or plain strings). */
export function manifestFeatureNames(features: unknown): string[] {
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature: unknown) => {
    if (typeof feature === 'string') return [feature];
    if (feature && typeof feature === 'object' && typeof (feature as { package?: unknown }).package === 'string') {
      return [(feature as { package: string }).package];
    }
    return [];
  });
}

/** `rss-add/[url]` → `rss-add <url>`; `[[x]]` → `[x]`; `[...x]` → `<...x>`. */
export function formatCommandRoute(route: string): string {
  return route.split('/').map((segment) => {
    const optional = segment.match(/^\[\[(\.\.\.)?([^\]]+)\]\]$/u);
    if (optional) return `[${optional[1] ?? ''}${optional[2]}]`;
    const required = segment.match(/^\[(\.\.\.)?([^\]]+)\]$/u);
    if (required) return `<${required[1] ?? ''}${required[2]}>`;
    return segment;
  }).join(' ');
}

/** `skill/rss/rss_list` → `rss_list（技能 rss）`; `agent/a/x` → `x（Agent a）`. */
export function formatToolName(name: string): string {
  const parts = name.split('/');
  if (parts[0] === 'skill' && parts.length === 3) return `${parts[2]}（技能 ${parts[1]}）`;
  if (parts[0] === 'agent' && parts.length === 3) return `${parts[2]}（Agent ${parts[1]}）`;
  if (parts[0] === 'agent' && parts[2] === 'skill' && parts.length === 5) return `${parts[4]}（Agent ${parts[1]} / 技能 ${parts[3]}）`;
  return name;
}

export interface PackageConfigField {
  readonly key: string;
  readonly type?: string;
  readonly default?: unknown;
  readonly description?: string;
}

/**
 * Top-level fields of the package's `schema.json`; `null` when the package ships none,
 * `[]` when it declares no fields.
 */
export function readPackageConfigFields(packageRoot: string): PackageConfigField[] | null {
  const file = join(packageRoot, 'schema.json');
  if (!existsSync(file)) return null;
  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const properties = schema && typeof schema === 'object' ? (schema as { properties?: unknown }).properties : undefined;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>).map(([key, value]) => {
    const field = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const type = Array.isArray(field.type) ? field.type.join(' | ') : typeof field.type === 'string' ? field.type : undefined;
    return {
      key,
      ...(type ? { type } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
      ...(typeof field.description === 'string' && field.description.trim() ? { description: field.description.trim() } : {}),
    };
  });
}

/** Installed root of `packageName` under `cwd` (walking up `node_modules`), if any. */
export function findInstalledPackageRoot(packageName: string, cwd = process.cwd()): string | undefined {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...packageName.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = join(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface PackageCapabilities {
  readonly root: string;
  readonly commands: readonly string[];
  readonly tools: readonly string[];
  readonly config: readonly PackageConfigField[] | null;
}

/** Commands, Agent tools and config fields of an installed package root. */
export async function readPackageCapabilities(packageRoot: string): Promise<PackageCapabilities> {
  const features = await scanConventionCapabilityFeatures(packageRoot);
  return {
    root: packageRoot,
    commands: (features.commands ?? []).map(formatCommandRoute),
    tools: (features.tools ?? []).map(formatToolName),
    config: readPackageConfigFields(packageRoot),
  };
}

/** One display line per config field: `key (type, 默认 x) — description`. */
export function formatConfigField(field: PackageConfigField): string {
  const meta = [field.type, field.default !== undefined ? `默认 ${JSON.stringify(field.default)}` : undefined].filter(Boolean).join('，');
  return `${field.key}${meta ? `（${meta}）` : ''}${field.description ? ` — ${field.description}` : ''}`;
}
