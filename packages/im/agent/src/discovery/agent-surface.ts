/**
 * Plugin `agent/` and `evals/` filesystem discovery (Eve-style authoring surface).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getLogger } from '@zhin.js/logger';
import {
  AUTHORING_KIND,
  isAuthoringDefinition,
  type AuthoringConnectionDefinition,
  type AuthoringEvalDefinition,
  type AuthoringHookDefinition,
  type AuthoringScheduleDefinition,
  type AuthoringSkillDefinition,
  type DiscoveredAuthoringConnection,
  type DiscoveredAuthoringEval,
  type DiscoveredAuthoringHook,
  type DiscoveredAuthoringSchedule,
  type DiscoveredAuthoringSkill,
  type DiscoveredPluginAgentSurface,
} from '../authoring/types.js';
import {
  namespaceAuthoringName,
  slotNameFromFile,
} from '../authoring/bridge.js';
import { errMsg } from './utils.js';

const logger = getLogger('agent-surface');

export interface PluginAgentRoots {
  pluginName: string;
  packageRoot: string;
  agentDir: string;
  evalsDir: string;
}

export function resolvePluginPackageRoot(filePath: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(dir);
  if (base === 'src' || base === 'lib') return path.dirname(dir);
  return dir;
}

/** Prefer compiled lib/*.js for production plugin packages. */
export function resolveAuthoringImportPath(packageRoot: string, sourcePath: string): string {
  const rel = path.relative(packageRoot, sourcePath);
  if (rel.includes(`${path.sep}hooks${path.sep}`) || rel.startsWith(`hooks${path.sep}`)) {
    const sibling = sourcePath.replace(/\.ts$/u, '.js');
    if (fs.existsSync(sibling)) return sibling;
  }
  if (rel.startsWith('agent/') || rel.startsWith('evals/')) {
    const jsRel = rel.replace(/\.ts$/, '.js');
    const libCandidate = path.join(packageRoot, 'lib', jsRel);
    if (fs.existsSync(libCandidate)) return libCandidate;
  }
  return sourcePath;
}

async function importAuthoringModule(filePath: string, packageRoot?: string): Promise<unknown> {
  const resolved = packageRoot
    ? resolveAuthoringImportPath(packageRoot, path.resolve(filePath))
    : path.resolve(filePath);
  if (!fs.existsSync(resolved)) return undefined;
  const url = `file://${resolved}?t=${Date.now()}`;
  const mod = await import(url);
  return mod.default ?? mod;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('$') && (f.endsWith('.ts') || f.endsWith('.js')))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function listSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('$')
        && (f.endsWith('.md') || f.endsWith('.ts') || f.endsWith('.js')))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

async function loadSkillFile(
  filePath: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
): Promise<DiscoveredAuthoringSkill | null> {
  const slotName = slotNameFromFile(filePath);
  if (filePath.endsWith('.md')) {
    const content = await readTextIfExists(filePath);
    if (!content) return null;
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trim();
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
    let description = slotName;
    let toolNames: string[] | undefined;
    let always: boolean | undefined;
    if (fm) {
      try {
        const jsYaml = await import('js-yaml');
        const yaml = jsYaml.default ?? jsYaml;
        const meta = yaml.load(fm[1]) as Record<string, unknown>;
        if (typeof meta.description === 'string') description = meta.description;
        if (Array.isArray(meta.tools)) toolNames = meta.tools.map(String);
        if (meta.always === true) always = true;
      } catch { /* ignore */ }
    }
    const definition: AuthoringSkillDefinition = {
      [AUTHORING_KIND]: 'skill',
      description,
      content: body,
      toolNames,
      always,
    };
    return {
      runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
      slotName,
      pluginName,
      filePath,
      definition,
    };
  }
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'skill')) return null;
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringSkillDefinition,
  };
}

async function loadScheduleFile(
  filePath: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
): Promise<DiscoveredAuthoringSchedule | null> {
  const slotName = slotNameFromFile(filePath);
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'schedule')) return null;
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringScheduleDefinition,
  };
}

async function loadConnectionFile(
  filePath: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
): Promise<DiscoveredAuthoringConnection | null> {
  const slotName = slotNameFromFile(filePath);
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'connection')) return null;
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringConnectionDefinition,
  };
}

async function loadHookFile(
  filePath: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
  placement?: { slotName: string; agentName?: string; skillName?: string },
): Promise<DiscoveredAuthoringHook | null> {
  const slotName = placement?.slotName ?? slotNameFromFile(filePath);
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'hook')) return null;
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringHookDefinition,
    ...(placement?.agentName ? { agentName: placement.agentName } : {}),
    ...(placement?.skillName ? { skillName: placement.skillName } : {}),
  };
}

async function loadEvalFile(
  filePath: string,
  pluginName: string,
  packageRoot?: string,
): Promise<DiscoveredAuthoringEval | null> {
  const slotName = slotNameFromFile(filePath).replace(/\.eval$/, '');
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'eval')) return null;
  return {
    runtimeName: `${pluginName}/${slotName}`,
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringEvalDefinition,
  };
}

async function scanAgentDir(
  agentDir: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
): Promise<Omit<DiscoveredPluginAgentSurface, 'pluginName' | 'agentDir' | 'evals'>> {
  const skills: DiscoveredAuthoringSkill[] = [];
  const schedules: DiscoveredAuthoringSchedule[] = [];
  const connections: DiscoveredAuthoringConnection[] = [];
  const hooks: DiscoveredAuthoringHook[] = [];
  for (const file of listSkillFiles(path.join(agentDir, 'skills'))) {
    const item = await loadSkillFile(file, pluginName, bareNames, packageRoot);
    if (item) skills.push(item);
  }
  for (const file of listTsFiles(path.join(agentDir, 'schedules'))) {
    const item = await loadScheduleFile(file, pluginName, bareNames, packageRoot);
    if (item) schedules.push(item);
  }
  for (const file of listTsFiles(path.join(agentDir, 'connections'))) {
    const item = await loadConnectionFile(file, pluginName, bareNames, packageRoot);
    if (item) connections.push(item);
  }
  return {
    skills,
    schedules,
    connections,
    hooks,
  };
}

export async function discoverPluginAgentSurface(
  roots: PluginAgentRoots,
): Promise<DiscoveredPluginAgentSurface | null> {
  if (!fs.existsSync(roots.agentDir)
    && !fs.existsSync(roots.evalsDir)
    && !hasDirectoryHooks(roots.packageRoot)) return null;
  try {
    const scanned = fs.existsSync(roots.agentDir)
      ? await scanAgentDir(roots.agentDir, roots.pluginName, false, roots.packageRoot)
      : {
          skills: [],
          schedules: [],
          connections: [],
          hooks: [],
        };
    scanned.hooks.push(...await discoverDirectoryHooks(
      roots.packageRoot,
      roots.pluginName,
      false,
    ));

    const evals: DiscoveredAuthoringEval[] = [];
    if (fs.existsSync(roots.evalsDir)) {
      for (const file of listTsFiles(roots.evalsDir)) {
        if (!file.includes('.eval.')) continue;
        const item = await loadEvalFile(file, roots.pluginName, roots.packageRoot);
        if (item) evals.push(item);
      }
    }

    return {
      pluginName: roots.pluginName,
      agentDir: roots.agentDir,
      ...scanned,
      evals,
    };
  } catch (e) {
    logger.warn(`Failed to discover agent surface for ${roots.pluginName}: ${errMsg(e)}`);
    return null;
  }
}

function hasDirectoryHooks(packageRoot: string): boolean {
  if (listDirectories(path.join(packageRoot, 'hooks')).length > 0) return true;
  for (const agent of listDirectories(path.join(packageRoot, 'agents'))) {
    if (listDirectories(path.join(packageRoot, 'agents', agent, 'hooks')).length > 0) return true;
    for (const skill of listDirectories(path.join(packageRoot, 'agents', agent, 'skills'))) {
      if (listDirectories(path.join(packageRoot, 'agents', agent, 'skills', skill, 'hooks')).length > 0) {
        return true;
      }
    }
  }
  return listDirectories(path.join(packageRoot, 'skills'))
    .some((skill) => listDirectories(path.join(packageRoot, 'skills', skill, 'hooks')).length > 0);
}

async function discoverDirectoryHooks(
  packageRoot: string,
  pluginName: string,
  bareNames: boolean,
): Promise<DiscoveredAuthoringHook[]> {
  const hooks: DiscoveredAuthoringHook[] = [];
  const add = async (
    root: string,
    prefix: string,
    placement: { agentName?: string; skillName?: string } = {},
  ) => {
    for (const entry of listDirectories(root)) {
      const source = preferredIndex(path.join(root, entry));
      if (!source) continue;
      const slotName = prefix ? `${prefix}/${entry}` : entry;
      const hook = await loadHookFile(source, pluginName, bareNames, packageRoot, {
        slotName,
        ...placement,
      });
      if (hook) hooks.push(hook);
    }
  };
  await add(path.join(packageRoot, 'hooks'), '');
  for (const agent of listDirectories(path.join(packageRoot, 'agents'))) {
    await add(path.join(packageRoot, 'agents', agent, 'hooks'), `agent/${agent}`, { agentName: agent });
    for (const skill of listDirectories(path.join(packageRoot, 'agents', agent, 'skills'))) {
      await add(
        path.join(packageRoot, 'agents', agent, 'skills', skill, 'hooks'),
        `agent/${agent}/skill/${skill}`,
        { agentName: agent, skillName: skill },
      );
    }
  }
  for (const skill of listDirectories(path.join(packageRoot, 'skills'))) {
    await add(path.join(packageRoot, 'skills', skill, 'hooks'), `skill/${skill}`, { skillName: skill });
  }
  return hooks;
}

function listDirectories(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function preferredIndex(directory: string): string | undefined {
  for (const name of ['index.ts', 'index.js', 'index.mjs', 'index.cjs']) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}
