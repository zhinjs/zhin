/**
 * Plugin `agent/` and `evals/` filesystem discovery (Eve-style authoring surface).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger, type Plugin } from '@zhin.js/core';
import {
  AUTHORING_KIND,
  isAuthoringDefinition,
  type AuthoringAgentDefinition,
  type AuthoringConnectionDefinition,
  type AuthoringEvalDefinition,
  type AuthoringHookDefinition,
  type AuthoringScheduleDefinition,
  type AuthoringSkillDefinition,
  type AuthoringToolDefinition,
  type DiscoveredAuthoringConnection,
  type DiscoveredAuthoringEval,
  type DiscoveredAuthoringHook,
  type DiscoveredAuthoringSchedule,
  type DiscoveredAuthoringSkill,
  type DiscoveredAuthoringTool,
  type DiscoveredPluginAgentSurface,
} from '../authoring/types.js';
import {
  namespaceAuthoringName,
  slotNameFromDir,
  slotNameFromFile,
} from '../authoring/bridge.js';
import { errMsg } from './utils.js';

const logger = new Logger(null, 'agent-surface');

export interface PluginAgentRoots {
  pluginName: string;
  plugin: Plugin;
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
  if (rel.startsWith('agent/') || rel.startsWith('evals/')) {
    const jsRel = rel.replace(/\.ts$/, '.js');
    const libCandidate = path.join(packageRoot, 'lib', jsRel);
    if (fs.existsSync(libCandidate)) return libCandidate;
  }
  return sourcePath;
}

export function collectPluginAgentRoots(root: Plugin | null | undefined): PluginAgentRoots[] {
  if (!root) return [];
  const out: PluginAgentRoots[] = [];
  const seen = new Set<string>();

  const push = (p: Plugin) => {
    if (!p?.filePath || !p.name) return;
    const packageRoot = resolvePluginPackageRoot(p.filePath);
    const key = `${p.name}:${packageRoot}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      pluginName: p.name,
      plugin: p,
      packageRoot,
      agentDir: path.join(packageRoot, 'agent'),
      evalsDir: path.join(packageRoot, 'evals'),
    });
  };

  const walk = (p: Plugin | null | undefined) => {
    if (!p) return;
    push(p);
    for (const child of (p.children || []) as Plugin[]) walk(child as Plugin);
  };
  walk(root);
  return out;
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
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function listSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.ts') || f.endsWith('.js'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function listSubagentDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function loadToolFile(
  filePath: string,
  pluginName: string,
  bareNames: boolean,
  packageRoot?: string,
): Promise<DiscoveredAuthoringTool | null> {
  const slotName = slotNameFromFile(filePath);
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'tool')) {
    logger.debug(`Skip non-tool authoring file: ${filePath}`);
    return null;
  }
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringToolDefinition,
  };
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
): Promise<DiscoveredAuthoringHook | null> {
  const slotName = slotNameFromFile(filePath);
  const exported = await importAuthoringModule(filePath, packageRoot);
  if (!isAuthoringDefinition(exported, 'hook')) return null;
  return {
    runtimeName: namespaceAuthoringName(pluginName, slotName, bareNames),
    slotName,
    pluginName,
    filePath,
    definition: exported as AuthoringHookDefinition,
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
  const tools: DiscoveredAuthoringTool[] = [];
  const skills: DiscoveredAuthoringSkill[] = [];
  const schedules: DiscoveredAuthoringSchedule[] = [];
  const connections: DiscoveredAuthoringConnection[] = [];
  const hooks: DiscoveredAuthoringHook[] = [];
  const subagents: DiscoveredPluginAgentSurface[] = [];

  let agentDefinition: AuthoringAgentDefinition | undefined;
  const agentTs = path.join(agentDir, 'agent.ts');
  const agentJs = path.join(agentDir, 'agent.js');
  const agentFile = fs.existsSync(agentTs) ? agentTs : (fs.existsSync(agentJs) ? agentJs : undefined);
  if (agentFile) {
    const exported = await importAuthoringModule(agentFile, packageRoot);
    if (isAuthoringDefinition(exported, 'agent')) {
      agentDefinition = exported as AuthoringAgentDefinition;
    }
  }

  const instructionsPath = [path.join(agentDir, 'instructions.md')]
    .find((p) => fs.existsSync(p));
  const instructionsBody = instructionsPath ? await readTextIfExists(instructionsPath) : undefined;

  for (const file of listTsFiles(path.join(agentDir, 'tools'))) {
    const item = await loadToolFile(file, pluginName, bareNames, packageRoot);
    if (item) tools.push(item);
  }
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
  for (const file of listTsFiles(path.join(agentDir, 'hooks'))) {
    const item = await loadHookFile(file, pluginName, bareNames, packageRoot);
    if (item) hooks.push(item);
  }

  for (const subDir of listSubagentDirs(path.join(agentDir, 'subagents'))) {
    const subName = slotNameFromDir(subDir);
    const subSurface = await scanAgentDir(subDir, pluginName, bareNames, packageRoot);
    subagents.push({
      pluginName,
      agentDir: subDir,
      ...subSurface,
      evals: [],
      subagents: subSurface.subagents,
    });
    // Subagent name overrides for registry
    const sub = subagents.at(-1);
    if (sub) {
      sub.agentDefinition = {
        ...(subSurface.agentDefinition ?? { [AUTHORING_KIND]: 'agent' as const }),
        description: subSurface.agentDefinition?.description ?? `Subagent ${subName}`,
      };
    }
  }

  return {
    agentDefinition,
    instructionsPath,
    instructionsBody: instructionsBody?.trim() || undefined,
    tools,
    skills,
    schedules,
    connections,
    hooks,
    subagents,
  };
}

export async function discoverPluginAgentSurface(
  roots: PluginAgentRoots,
): Promise<DiscoveredPluginAgentSurface | null> {
  if (!fs.existsSync(roots.agentDir) && !fs.existsSync(roots.evalsDir)) return null;
  try {
    const scanned = fs.existsSync(roots.agentDir)
      ? await scanAgentDir(roots.agentDir, roots.pluginName, false, roots.packageRoot)
      : {
          tools: [],
          skills: [],
          schedules: [],
          connections: [],
          hooks: [],
          subagents: [],
        };

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

export async function discoverAllPluginAgentSurfaces(
  root: Plugin | null | undefined,
): Promise<DiscoveredPluginAgentSurface[]> {
  const surfaces: DiscoveredPluginAgentSurface[] = [];
  for (const r of collectPluginAgentRoots(root)) {
    const surface = await discoverPluginAgentSurface(r);
    if (surface) surfaces.push(surface);
  }
  return surfaces;
}

export function workspaceAgentsDir(): string {
  return path.join(process.cwd(), 'agents');
}

export async function discoverWorkspaceFractalAgent(
  agentDir: string,
): Promise<{
  name: string;
  agentDefinition?: AuthoringAgentDefinition;
  instructionsBody?: string;
  agentDir: string;
} | null> {
  const name = slotNameFromDir(agentDir);
  if (!fs.existsSync(agentDir)) return null;
  const scanned = await scanAgentDir(agentDir, 'workspace', true);
  return {
    name,
    agentDefinition: scanned.agentDefinition,
    instructionsBody: scanned.instructionsBody,
    agentDir,
  };
}

export async function discoverWorkspaceFractalAgents(): Promise<Array<{
  name: string;
  agentDefinition?: AuthoringAgentDefinition;
  instructionsBody?: string;
  agentDir: string;
}>> {
  const base = workspaceAgentsDir();
  if (!fs.existsSync(base)) return [];
  const agents: Array<{
    name: string;
    agentDefinition?: AuthoringAgentDefinition;
    instructionsBody?: string;
    agentDir: string;
  }> = [];
  for (const dir of listSubagentDirs(base)) {
    const item = await discoverWorkspaceFractalAgent(dir);
    if (item?.agentDefinition?.description || item?.instructionsBody) {
      agents.push(item);
    }
  }
  return agents;
}
