/**
 * Agent surface diagnostic report — filesystem scan (ADR 0039 P2, Eve `info` parity).
 * Does not boot IM runtime; safe for `zhin agent info` CLI.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { namespaceAuthoringName, slotNameFromDir, slotNameFromFile } from '../authoring/bridge.js';

export interface AgentSurfacePluginInfo {
  pluginName: string;
  packageRoot: string;
  agentDir: string;
  tools: string[];
  skills: string[];
  schedules: string[];
  connections: string[];
  hooks: string[];
  states: string[];
  subagents: string[];
  evals: string[];
  hasInstructions: boolean;
  hasAgentTs: boolean;
  hasDynamic?: boolean;
  disallowedTools?: string[];
}

export interface AgentSurfaceWorkspaceAgentInfo {
  name: string;
  agentDir: string;
  hasInstructions: boolean;
  hasAgentTs: boolean;
}

export interface AgentSurfaceInfoReport {
  cwd: string;
  workspaceAgents: AgentSurfaceWorkspaceAgentInfo[];
  plugins: AgentSurfacePluginInfo[];
  totals: {
    plugins: number;
    tools: number;
    skills: number;
    schedules: number;
    connections: number;
    hooks: number;
    subagents: number;
    evals: number;
    workspaceAgents: number;
  };
}

function listFiles(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => ext.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function listSubdirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function readPackageName(packageRoot: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string };
    return typeof pkg.name === 'string' ? pkg.name : undefined;
  } catch {
    return undefined;
  }
}

/** Align with runtime Plugin.name (lottery, dingtalk, …) not full npm scope. */
function pluginIdFromPackageName(packageName: string): string {
  const stripped = packageName.replace(/^@zhin\.js\//, '');
  if (stripped.startsWith('plugin-')) return stripped.slice('plugin-'.length);
  if (stripped.startsWith('adapter-')) return stripped.slice('adapter-'.length);
  return stripped.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function resolvePluginId(packageRoot: string): string {
  const pkgName = readPackageName(packageRoot);
  if (pkgName) return pluginIdFromPackageName(pkgName);
  return path.basename(packageRoot);
}

function collectPluginRoots(cwd: string): string[] {
  const roots = new Set<string>();
  const candidates = [
    path.join(cwd, 'plugins'),
    path.join(cwd, 'node_modules'),
  ];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    for (const group of listSubdirs(base)) {
      for (const pkg of listSubdirs(group)) {
        if (fs.existsSync(path.join(pkg, 'agent'))) roots.add(pkg);
      }
      if (fs.existsSync(path.join(group, 'agent'))) roots.add(group);
    }
  }
  return [...roots];
}

function scanPluginSurface(packageRoot: string): AgentSurfacePluginInfo | null {
  const agentDir = path.join(packageRoot, 'agent');
  const evalsDir = path.join(packageRoot, 'evals');
  if (!fs.existsSync(agentDir) && !fs.existsSync(evalsDir)) return null;

  const pluginName = resolvePluginId(packageRoot);
  const tools = listFiles(path.join(agentDir, 'tools'), /\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const skills = [
    ...listFiles(path.join(agentDir, 'skills'), /\.(md|ts|js)$/i),
  ].map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const schedules = listFiles(path.join(agentDir, 'schedules'), /\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const connections = listFiles(path.join(agentDir, 'connections'), /\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const hooks = listFiles(path.join(agentDir, 'hooks'), /\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const states = listFiles(path.join(agentDir, 'state'), /\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));
  const subagents = listSubdirs(path.join(agentDir, 'subagents'))
    .map((d) => namespaceAuthoringName(pluginName, slotNameFromDir(d), true));
  const evals = listFiles(evalsDir, /\.eval\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));

  return {
    pluginName,
    packageRoot,
    agentDir,
    tools,
    skills,
    schedules,
    connections,
    hooks,
    states,
    subagents,
    evals,
    hasInstructions: fs.existsSync(path.join(agentDir, 'instructions.md')),
    hasAgentTs: fs.existsSync(path.join(agentDir, 'agent.ts'))
      || fs.existsSync(path.join(agentDir, 'agent.js')),
    hasDynamic: fs.existsSync(path.join(agentDir, 'dynamic.ts'))
      || fs.existsSync(path.join(agentDir, 'dynamic.js')),
  };
}

function scanWorkspaceAgents(cwd: string): AgentSurfaceWorkspaceAgentInfo[] {
  const agentsDir = path.join(cwd, 'agents');
  const out: AgentSurfaceWorkspaceAgentInfo[] = [];
  for (const dir of listSubdirs(agentsDir)) {
    out.push({
      name: slotNameFromDir(dir),
      agentDir: dir,
      hasInstructions: fs.existsSync(path.join(dir, 'instructions.md')),
      hasAgentTs: fs.existsSync(path.join(dir, 'agent.ts'))
        || fs.existsSync(path.join(dir, 'agent.js')),
    });
  }
  return out;
}

export async function buildAgentSurfaceInfoReport(
  cwd: string = process.cwd(),
): Promise<AgentSurfaceInfoReport> {
  const plugins: AgentSurfacePluginInfo[] = [];
  for (const packageRoot of collectPluginRoots(cwd)) {
    const info = scanPluginSurface(packageRoot);
    if (info) plugins.push(info);
  }
  plugins.sort((a, b) => a.pluginName.localeCompare(b.pluginName));

  const workspaceAgents = scanWorkspaceAgents(cwd);
  const totals = {
    plugins: plugins.length,
    tools: plugins.reduce((n, p) => n + p.tools.length, 0),
    skills: plugins.reduce((n, p) => n + p.skills.length, 0),
    schedules: plugins.reduce((n, p) => n + p.schedules.length, 0),
    connections: plugins.reduce((n, p) => n + p.connections.length, 0),
    hooks: plugins.reduce((n, p) => n + p.hooks.length, 0),
    subagents: plugins.reduce((n, p) => n + p.subagents.length, 0),
    evals: plugins.reduce((n, p) => n + p.evals.length, 0),
    workspaceAgents: workspaceAgents.length,
  };

  return { cwd, workspaceAgents, plugins, totals };
}

export function formatAgentSurfaceInfoReport(report: AgentSurfaceInfoReport): string {
  const lines: string[] = [
    `Agent surface (cwd: ${report.cwd})`,
    '',
    `Totals: ${report.totals.plugins} plugin(s), ${report.totals.tools} tool(s), `
      + `${report.totals.skills} skill(s), ${report.totals.workspaceAgents} workspace agent(s)`,
    '',
  ];

  if (report.workspaceAgents.length) {
    lines.push('Workspace agents:');
    for (const a of report.workspaceAgents) {
      const flags = [
        a.hasAgentTs ? 'agent.ts' : null,
        a.hasInstructions ? 'instructions.md' : null,
      ].filter(Boolean).join(', ');
      lines.push(`  - ${a.name}  (${flags || 'empty'})`);
    }
    lines.push('');
  }

  for (const p of report.plugins) {
    lines.push(`${p.pluginName}  [${p.agentDir}]`);
    if (p.tools.length) lines.push(`  tools: ${p.tools.join(', ')}`);
    if (p.skills.length) lines.push(`  skills: ${p.skills.join(', ')}`);
    if (p.schedules.length) lines.push(`  schedules: ${p.schedules.join(', ')}`);
    if (p.connections.length) lines.push(`  connections: ${p.connections.join(', ')}`);
    if (p.hooks.length) lines.push(`  hooks: ${p.hooks.join(', ')}`);
    if (p.subagents.length) lines.push(`  subagents: ${p.subagents.join(', ')}`);
    if (p.evals.length) lines.push(`  evals: ${p.evals.join(', ')}`);
    if (!p.tools.length && !p.skills.length && !p.schedules.length
      && !p.connections.length && !p.hooks.length && !p.subagents.length && !p.evals.length) {
      lines.push('  (empty agent/)');
    }
    lines.push('');
  }

  if (!report.plugins.length && !report.workspaceAgents.length) {
    lines.push('No agent/ surfaces found under plugins/ or agents/.');
  }

  return lines.join('\n').trimEnd();
}
