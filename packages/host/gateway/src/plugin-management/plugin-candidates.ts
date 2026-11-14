/**
 * Official packages a user probably meant by a short or misspelled plugin name (#1250). `zhin enable
 * reminder` must never suggest `zhin install reminder`: that is an unrelated third-party package on
 * npm. Suggestions only come from the official catalog and the project's installed `@zhin.js/*`
 * packages — never from the request itself.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInstallAllowlist } from '../onboarding/allowlist.js';
import { pluginUseCases } from './use-cases.js';

const OFFICIAL_SCOPE = '@zhin.js/';
const KIND_PREFIXES = ['plugin-', 'adapter-', 'service-', 'game-'] as const;

/** `@zhin.js/plugin-reminder`, `plugin-reminder` and `reminder` all reduce to `reminder`. */
function baseName(name: string): string {
  let base = name.trim().toLowerCase();
  if (base.startsWith(OFFICIAL_SCOPE)) base = base.slice(OFFICIAL_SCOPE.length);
  for (const prefix of KIND_PREFIXES) if (base.startsWith(prefix)) return base.slice(prefix.length);
  return base;
}

/** The offline official catalog: catalog adapters, use-case plugins and Market entries. */
export function officialPluginCatalog(): readonly string[] {
  const names = new Set<string>();
  for (const entry of createInstallAllowlist().entries()) {
    if (entry.kind === 'adapter' && entry.name.startsWith(OFFICIAL_SCOPE)) names.add(entry.name);
  }
  for (const useCase of pluginUseCases) names.add(useCase.packageName);
  return Object.freeze([...names].sort());
}

async function installedOfficialPackages(projectRoot: string): Promise<readonly string[]> {
  const entries = await readdir(join(projectRoot, 'node_modules', '@zhin.js')).catch(() => [] as string[]);
  return entries.filter(name => !name.startsWith('.')).map(name => `${OFFICIAL_SCOPE}${name}`);
}

/**
 * Official package names matching `request` (same name once the `@zhin.js/` scope and the
 * `plugin-` / `adapter-` / `service-` / `game-` prefix are dropped). Empty when nothing matches.
 */
export async function officialPluginCandidates(request: string, projectRoot?: string): Promise<readonly string[]> {
  const wanted = baseName(request);
  if (!wanted) return [];
  const pool = new Set([...officialPluginCatalog(), ...(projectRoot ? await installedOfficialPackages(projectRoot) : [])]);
  return Object.freeze([...pool].filter(name => baseName(name) === wanted).sort());
}

/** The message for an instance that is not declared: install hints only for official candidates. */
export function undeclaredPluginMessage(request: string, candidates: readonly string[]): string {
  const head = `找不到插件实例 ${request}（配置中没有声明）`;
  if (!candidates.length) return head;
  return `${head}。官方插件中名称相近的有：${candidates.join('、')}；如果要用它，运行 ${candidates.map(name => `zhin install ${name}`).join(' 或 ')}`;
}
