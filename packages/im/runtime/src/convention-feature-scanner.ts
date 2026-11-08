import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const NAMED_CODE_DIRECTORIES = [
  'adapters',
  'components',
  'handlers',
  'hooks',
  'mcps',
  'middlewares',
  'pages',
  'schedules',
  'tools',
] as const;

const ENTRY_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs'] as const;

async function hasAnyEntryFile(dir: string, candidates: readonly string[]): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    return candidates.some((c) => fileNames.has(c));
  } catch {
    return false;
  }
}

async function scanRecursiveCommands(
  dir: string,
  prefix = '',
  depth = 0,
): Promise<readonly string[]> {
  if (depth > 16) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  if (prefix && ENTRY_FILES.some((f) => fileNames.has(f))) {
    found.push(prefix);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nested = await scanRecursiveCommands(join(dir, entry.name), nextPrefix, depth + 1);
    found.push(...nested);
  }
  return found;
}

async function scanNamedSubdirectories(
  rootDir: string,
  entryCandidates: readonly string[],
): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }
    if (await hasAnyEntryFile(join(rootDir, entry.name), entryCandidates)) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

async function listValidSubdirectoryNames(rootDir: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

async function resolveDefaultPluginName(absRoot: string): Promise<string> {
  for (const entryFile of ['plugin.ts', 'plugin.js', 'plugin.mjs']) {
    try {
      const content = await readFile(join(absRoot, entryFile), 'utf8');
      const match = content.match(/\bdefinePlugin\s*\(\s*\{[\s\S]*?\bname\s*:\s*['"]([^'"]+)['"]/u);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    } catch {
      // ignore missing plugin file
    }
  }
  try {
    const pkgRaw = await readFile(join(absRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name.trim()) {
      return pkg.name
        .trim()
        .replace(/^@zhin\.js\/(?:plugin-|adapter-)?/u, '')
        .replace(/^@[^/]+\//u, '');
    }
  } catch {
    // ignore missing or invalid package.json
  }
  return basename(absRoot) || 'plugin';
}

/**
 * Scans a plugin package root for convention-based capability directories
 * (`commands/**`, `tools/*`, `skills/*`, `handlers/*`, `middlewares/*`, `components/*`,
 * `pages/*`, `schedules/*`, `mcps/*`, `hooks/*`, `agents/*`, `adapters/*`, `prompt-sections/*`),
 * including progressive-disclosure nested `tools`, `skills`, and `hooks` under `skills/*` and `agents/*`.
 */
export async function scanConventionCapabilityFeatures(
  packageRoot: string,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const absRoot = resolve(packageRoot);
  const result: Record<string, readonly string[]> = {};

  const commands = await scanRecursiveCommands(join(absRoot, 'commands'));
  if (commands.length > 0) {
    result.commands = Object.freeze([...new Set(commands)].sort());
  }

  for (const dirName of NAMED_CODE_DIRECTORIES) {
    const items = await scanNamedSubdirectories(join(absRoot, dirName), ENTRY_FILES);
    if (items.length > 0) {
      result[dirName] = Object.freeze(items);
    }
  }

  const promptSections = await scanNamedSubdirectories(join(absRoot, 'prompt-sections'), ENTRY_FILES);
  if (promptSections.length > 0) {
    result.promptSections = Object.freeze(promptSections);
  }

  const rootSkills = await scanNamedSubdirectories(join(absRoot, 'skills'), ['SKILL.md']);
  const agents = await scanNamedSubdirectories(join(absRoot, 'agents'), ['agent.json']);
  if (agents.length > 0) {
    result.agents = Object.freeze(agents);
  }

  const allTools = new Set<string>(result.tools ?? []);
  const allHooks = new Set<string>(result.hooks ?? []);
  const allSkills = new Set<string>(rootSkills);

  // Scan progressive-disclosure tools/hooks under skills/<skill>/{tools,hooks}/<name>
  const skillDirs = await listValidSubdirectoryNames(join(absRoot, 'skills'));
  for (const skillName of skillDirs) {
    const skillRoot = join(absRoot, 'skills', skillName);
    const skillTools = await scanNamedSubdirectories(join(skillRoot, 'tools'), ENTRY_FILES);
    for (const toolName of skillTools) {
      allTools.add(`skill/${skillName}/${toolName}`);
    }
    const skillHooks = await scanNamedSubdirectories(join(skillRoot, 'hooks'), ENTRY_FILES);
    for (const hookName of skillHooks) {
      allHooks.add(`skill/${skillName}/${hookName}`);
    }
  }

  // Scan progressive-disclosure tools/hooks/skills under agents/<agent>/...
  const agentDirs = await listValidSubdirectoryNames(join(absRoot, 'agents'));
  for (const agentName of agentDirs) {
    const agentRoot = join(absRoot, 'agents', agentName);
    const agentTools = await scanNamedSubdirectories(join(agentRoot, 'tools'), ENTRY_FILES);
    for (const toolName of agentTools) {
      allTools.add(`agent/${agentName}/${toolName}`);
    }
    const agentHooks = await scanNamedSubdirectories(join(agentRoot, 'hooks'), ENTRY_FILES);
    for (const hookName of agentHooks) {
      allHooks.add(`agent/${agentName}/${hookName}`);
    }
    const agentSkills = await scanNamedSubdirectories(join(agentRoot, 'skills'), ['SKILL.md']);
    for (const skillName of agentSkills) {
      allSkills.add(`agent/${agentName}/${skillName}`);
    }
    const agentSkillDirs = await listValidSubdirectoryNames(join(agentRoot, 'skills'));
    for (const skillName of agentSkillDirs) {
      const nestedSkillRoot = join(agentRoot, 'skills', skillName);
      const nestedTools = await scanNamedSubdirectories(join(nestedSkillRoot, 'tools'), ENTRY_FILES);
      for (const toolName of nestedTools) {
        allTools.add(`agent/${agentName}/skill/${skillName}/${toolName}`);
      }
      const nestedHooks = await scanNamedSubdirectories(join(nestedSkillRoot, 'hooks'), ENTRY_FILES);
      for (const hookName of nestedHooks) {
        allHooks.add(`agent/${agentName}/skill/${skillName}/${hookName}`);
      }
    }
  }

  if (allTools.size > 0) {
    result.tools = Object.freeze([...allTools].sort());
  }
  if (allHooks.size > 0) {
    result.hooks = Object.freeze([...allHooks].sort());
  }
  if (allSkills.size > 0) {
    result.skills = Object.freeze([...allSkills].sort());
  }

  return Object.freeze(result);
}

export interface PluginCapabilityCodegenResult {
  readonly packageRoot: string;
  readonly pluginName: string;
  readonly features: Readonly<Record<string, readonly string[]>>;
  readonly dts: string;
  readonly snippet: string;
}

/**
 * Generates static TypeScript declarations (`plugin.capabilities.d.ts`) and a
 * `definePluginCapabilityGraph` snippet from a plugin's convention directories.
 */
export async function generatePluginCapabilityCodegen(
  packageRoot: string,
  options?: { readonly pluginName?: string },
): Promise<PluginCapabilityCodegenResult> {
  const absRoot = resolve(packageRoot);
  const info = await stat(absRoot).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`Plugin directory does not exist: ${absRoot}`);
  }
  const pluginName = options?.pluginName?.trim() || (await resolveDefaultPluginName(absRoot));
  const features = await scanConventionCapabilityFeatures(absRoot);

  const featureLines = Object.entries(features).map(
    ([key, items]) =>
      `  readonly ${JSON.stringify(key)}: readonly [${items.map((i) => JSON.stringify(i)).join(', ')}];`,
  );

  const dts = [
    '// Auto-generated by `zhin runtime codegen` — DO NOT EDIT MANUALLY.',
    `export interface DiscoveredPluginCapabilities {`,
    ...(featureLines.length > 0 ? featureLines : ['  readonly [key: string]: readonly string[];']),
    '}',
    '',
    `export declare const pluginDiscoveredFeatures: DiscoveredPluginCapabilities;`,
    '',
  ].join('\n');

  const snippetFeatures = Object.entries(features)
    .map(([key, items]) => `    ${key}: [${items.map((i) => JSON.stringify(i)).join(', ')}],`)
    .join('\n');

  const snippet = [
    'definePluginCapabilityGraph({',
    '  provides: [],',
    '  injects: [],',
    ...(snippetFeatures
      ? ['  // Auto-merged from convention directories at runtime:', '  features: {', snippetFeatures, '  },']
      : []),
    '})',
  ].join('\n');

  return Object.freeze({
    packageRoot: absRoot,
    pluginName,
    features,
    dts,
    snippet,
  });
}
