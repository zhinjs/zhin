/**
 * Agent surface diagnostic report — filesystem scan (ADR 0039 P2, Eve `info` parity).
 * Does not boot IM runtime; safe for `zhin agent info` CLI.
 *
 * Counts what the Plugin Runtime discovers from convention directories (#1250
 * `agent-info-misses-root-capabilities`): the project root itself (`tools/`, `skills/`,
 * `agents/*` …, the application plugin), local plugins under `plugins/`, and installed packages
 * that carry a `package.json#zhin` manifest; grouped by that source. Framework built-in tools and
 * MCP tools are not files of the project and are not counted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import { namespaceAuthoringName, slotNameFromDir, slotNameFromFile } from '../authoring/bridge.js';

/** `project`: the project root; `local`: `plugins/**`; `installed`: `node_modules` packages with a zhin manifest. */
export type AgentSurfaceSource = 'project' | 'local' | 'installed';

export const AGENT_SURFACE_SOURCES: readonly AgentSurfaceSource[] = Object.freeze(['project', 'local', 'installed']);

export interface AgentSurfaceCounts {
  plugins: number;
  tools: number;
  skills: number;
  hooks: number;
  promptSections: number;
  subagents: number;
  evals: number;
}

export interface AgentSurfacePluginInfo {
  pluginName: string;
  packageRoot: string;
  source: AgentSurfaceSource;
  tools: string[];
  skills: string[];
  hooks: string[];
  promptSections: string[];
  subagents: string[];
  evals: string[];
  hasAgentsMd: boolean;
  disallowedTools?: string[];
}

export interface AgentSurfaceWorkspaceAgentInfo {
  name: string;
  agentDir: string;
  hasManifest: boolean;
  coreComplete: boolean;
}

export interface AgentSurfaceInfoReport {
  cwd: string;
  workspaceAgents: AgentSurfaceWorkspaceAgentInfo[];
  plugins: AgentSurfacePluginInfo[];
  totals: AgentSurfaceCounts & { workspaceAgents: number };
  /** The same counts per source. */
  bySource: Record<AgentSurfaceSource, AgentSurfaceCounts>;
}

function listFiles(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('$') && ext.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)];
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

function listNamedEntries(dir: string, entryNames: readonly string[]): string[] {
  return listSubdirs(dir).filter((child) => entryNames.some(
    (entryName) => fs.existsSync(path.join(child, entryName)),
  ));
}

function scopedModuleSlots(
  packageRoot: string,
  kind: 'tools' | 'hooks',
): string[] {
  const entryNames = ['index.ts', 'index.js'];
  const slots = listNamedEntries(path.join(packageRoot, kind), entryNames)
    .map(slotNameFromDir);
  for (const agentDir of listSubdirs(path.join(packageRoot, 'agents'))) {
    const agent = slotNameFromDir(agentDir);
    slots.push(...listNamedEntries(path.join(agentDir, kind), entryNames)
      .map((entry) => `agent/${agent}/${slotNameFromDir(entry)}`));
    for (const skillDir of listSubdirs(path.join(agentDir, 'skills'))) {
      const skill = slotNameFromDir(skillDir);
      slots.push(...listNamedEntries(path.join(skillDir, kind), entryNames)
        .map((entry) => `agent/${agent}/skill/${skill}/${slotNameFromDir(entry)}`));
    }
  }
  for (const skillDir of listSubdirs(path.join(packageRoot, 'skills'))) {
    const skill = slotNameFromDir(skillDir);
    slots.push(...listNamedEntries(path.join(skillDir, kind), entryNames)
      .map((entry) => `skill/${skill}/${slotNameFromDir(entry)}`));
  }
  return slots;
}

function scopedSkillSlots(packageRoot: string): string[] {
  const slots = listNamedEntries(path.join(packageRoot, 'skills'), ['SKILL.md'])
    .map(slotNameFromDir);
  for (const agentDir of listSubdirs(path.join(packageRoot, 'agents'))) {
    const agent = slotNameFromDir(agentDir);
    slots.push(...listNamedEntries(path.join(agentDir, 'skills'), ['SKILL.md'])
      .map((entry) => `agent/${agent}/${slotNameFromDir(entry)}`));
  }
  return slots;
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

const SURFACE_ENTRIES = ['agents', 'tools', 'skills', 'hooks', 'prompt-sections', 'AGENTS.md'] as const;

function hasSurface(dir: string): boolean {
  return SURFACE_ENTRIES.some((entry) => fs.existsSync(path.join(dir, entry)));
}

function hasZhinManifest(packageRoot: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as { zhin?: unknown };
    return !!pkg.zhin && typeof pkg.zhin === 'object';
  } catch {
    return false;
  }
}

function realPath(dir: string): string {
  try { return fs.realpathSync(dir); } catch { return dir; }
}

function collectPluginRoots(cwd: string): { root: string; source: AgentSurfaceSource }[] {
  const roots = new Map<string, { root: string; source: AgentSurfaceSource }>();
  const add = (dir: string, source: AgentSurfaceSource) => {
    const key = realPath(dir);
    if (key === realPath(cwd) || roots.has(key)) return;
    roots.set(key, { root: dir, source });
  };
  const candidates: { base: string; source: AgentSurfaceSource }[] = [
    { base: path.join(cwd, 'plugins'), source: 'local' },
    { base: path.join(cwd, 'node_modules'), source: 'installed' },
  ];
  for (const { base, source } of candidates) {
    if (!fs.existsSync(base)) continue;
    // Installed packages count only when they are zhin packages (a stray `tools/` is not a plugin).
    const accepts = (dir: string) => hasSurface(dir) && (source === 'local' || hasZhinManifest(dir));
    for (const group of listSubdirs(base)) {
      for (const pkg of listSubdirs(group)) if (accepts(pkg)) add(pkg, source);
      if (accepts(group)) add(group, source);
    }
  }
  return [...roots.values()];
}

function scanPluginSurface(packageRoot: string, source: AgentSurfaceSource): AgentSurfacePluginInfo | null {
  const evalsDir = path.join(packageRoot, 'evals');
  if (!fs.existsSync(evalsDir)
    && !fs.existsSync(path.join(packageRoot, 'agents'))
    && !fs.existsSync(path.join(packageRoot, 'tools'))
    && !fs.existsSync(path.join(packageRoot, 'skills'))
    && !fs.existsSync(path.join(packageRoot, 'hooks'))
    && !fs.existsSync(path.join(packageRoot, 'prompt-sections'))
    && !fs.existsSync(path.join(packageRoot, 'AGENTS.md'))) return null;

  const pluginName = resolvePluginId(packageRoot);
  const tools = uniqueNames(scopedModuleSlots(packageRoot, 'tools')
    .map((slot) => namespaceAuthoringName(pluginName, slot)));
  const skills = scopedSkillSlots(packageRoot)
    .map((slot) => namespaceAuthoringName(pluginName, slot));
  const hooks = scopedModuleSlots(packageRoot, 'hooks')
    .map((slot) => namespaceAuthoringName(pluginName, slot));
  const promptSections = listNamedEntries(
    path.join(packageRoot, 'prompt-sections'),
    ['index.ts', 'index.js'],
  ).map((entry) => namespaceAuthoringName(pluginName, slotNameFromDir(entry)));
  const subagents = listSubdirs(path.join(packageRoot, 'agents'))
    .filter((dir) => fs.existsSync(path.join(dir, 'agent.json')))
    .map((dir) => namespaceAuthoringName(pluginName, slotNameFromDir(dir), true));
  const evals = listFiles(evalsDir, /\.eval\.(ts|js)$/i)
    .map((f) => namespaceAuthoringName(pluginName, slotNameFromFile(f)));

  return {
    pluginName,
    packageRoot,
    source,
    tools,
    skills,
    hooks,
    promptSections,
    subagents,
    evals,
    hasAgentsMd: fs.existsSync(path.join(packageRoot, 'AGENTS.md')),
  };
}

function scanWorkspaceAgents(cwd: string): AgentSurfaceWorkspaceAgentInfo[] {
  const agentsDir = path.join(cwd, 'agents');
  const out: AgentSurfaceWorkspaceAgentInfo[] = [];
  for (const dir of listSubdirs(agentsDir)) {
    out.push({
      name: slotNameFromDir(dir),
      agentDir: dir,
      hasManifest: fs.existsSync(path.join(dir, 'agent.json')),
      coreComplete: ['agent.json', 'system.md', 'boundaries.md', 'conventions.md']
        .every((name) => fs.existsSync(path.join(dir, name))),
    });
  }
  return out;
}

export async function buildAgentSurfaceInfoReport(
  cwd: string = process.cwd(),
): Promise<AgentSurfaceInfoReport> {
  const plugins: AgentSurfacePluginInfo[] = [];
  // The project root is the application plugin: its convention directories are discovered too.
  const project = scanPluginSurface(cwd, 'project');
  // Root `agents/*` are listed as workspace agents below; their tools / skills stay counted here.
  if (project) plugins.push({ ...project, subagents: [] });
  const others: AgentSurfacePluginInfo[] = [];
  for (const { root, source } of collectPluginRoots(cwd)) {
    const info = scanPluginSurface(root, source);
    if (info) others.push(info);
  }
  const order = (source: AgentSurfaceSource) => AGENT_SURFACE_SOURCES.indexOf(source);
  others.sort((a, b) => order(a.source) - order(b.source) || a.pluginName.localeCompare(b.pluginName));
  plugins.push(...others);

  const workspaceAgents = scanWorkspaceAgents(cwd);
  const count = (list: readonly AgentSurfacePluginInfo[]): AgentSurfaceCounts => ({
    plugins: list.length,
    tools: list.reduce((n, p) => n + p.tools.length, 0),
    skills: list.reduce((n, p) => n + p.skills.length, 0),
    hooks: list.reduce((n, p) => n + p.hooks.length, 0),
    promptSections: list.reduce((n, p) => n + p.promptSections.length, 0),
    subagents: list.reduce((n, p) => n + p.subagents.length, 0),
    evals: list.reduce((n, p) => n + p.evals.length, 0),
  });
  const totals = { ...count(plugins), workspaceAgents: workspaceAgents.length };
  const bySource = Object.fromEntries(AGENT_SURFACE_SOURCES.map((source) => [source, count(plugins.filter((p) => p.source === source))])) as Record<AgentSurfaceSource, AgentSurfaceCounts>;

  return { cwd, workspaceAgents, plugins, totals, bySource };
}

const t = createMessages({
  title: { 'zh-CN': 'Agent 能力（项目目录：{cwd}）', en: 'Agent capabilities (project: {cwd})' },
  totals: {
    'zh-CN': '合计：{plugins} 个来源包、{tools} 个工具、{skills} 个技能、{workspaceAgents} 个工作区 Agent',
    en: 'Totals: {plugins} package(s), {tools} tool(s), {skills} skill(s), {workspaceAgents} workspace agent(s)',
  },
  bySource: { 'zh-CN': '  {source}：{plugins} 个包、{tools} 个工具、{skills} 个技能', en: '  {source}: {plugins} package(s), {tools} tool(s), {skills} skill(s)' },
  scope: {
    'zh-CN': '只统计项目文件中的约定目录；框架内置工具与 MCP 工具不在其中（运行时实际可用的工具数见 zhin trace）。',
    en: 'Counts the convention directories in project files only; framework built-in and MCP tools are not included (zhin trace shows the tools available at run time).',
  },
  'source.project': { 'zh-CN': '项目根目录', en: 'Project root' },
  'source.local': { 'zh-CN': '本地插件（plugins/）', en: 'Local plugins (plugins/)' },
  'source.installed': { 'zh-CN': '已安装的插件（node_modules）', en: 'Installed plugins (node_modules)' },
  workspaceAgents: { 'zh-CN': '工作区 Agent（agents/）：', en: 'Workspace agents (agents/):' },
  'agent.complete': { 'zh-CN': '完整', en: 'complete' },
  'agent.incomplete': { 'zh-CN': '缺少核心文件', en: 'incomplete' },
  'agent.none': { 'zh-CN': '不是 Agent（没有 agent.json）', en: 'not an agent' },
  tools: { 'zh-CN': '  工具：{list}', en: '  tools: {list}' },
  skills: { 'zh-CN': '  技能：{list}', en: '  skills: {list}' },
  hooks: { 'zh-CN': '  Hook：{list}', en: '  hooks: {list}' },
  promptSections: { 'zh-CN': '  Prompt 段：{list}', en: '  prompt sections: {list}' },
  subagents: { 'zh-CN': '  子 Agent：{list}', en: '  subagents: {list}' },
  main: { 'zh-CN': '  主 Agent：AGENTS.md', en: '  main: AGENTS.md' },
  evals: { 'zh-CN': '  评测：{list}', en: '  evals: {list}' },
  empty: { 'zh-CN': '  （没有能力）', en: '  (no capabilities)' },
  none: {
    'zh-CN': '在项目根目录、plugins/、node_modules 与 agents/ 中没有找到 Agent 能力。',
    en: 'No Agent capabilities found in the project root, plugins/, node_modules or agents/.',
  },
});

/** Human-readable report in the CLI's display language (`zh-CN` by default). */
export function formatAgentSurfaceInfoReport(report: AgentSurfaceInfoReport, locale?: Locale): string {
  const lines: string[] = [
    t(locale, 'title', { cwd: report.cwd }),
    '',
    t(locale, 'totals', { plugins: report.totals.plugins, tools: report.totals.tools, skills: report.totals.skills, workspaceAgents: report.totals.workspaceAgents }),
  ];
  // Older reports (no `source`) have no per-source counts.
  for (const source of report.bySource ? AGENT_SURFACE_SOURCES : []) {
    const counts = report.bySource[source];
    if (!counts?.plugins) continue;
    lines.push(t(locale, 'bySource', { source: t(locale, `source.${source}`), plugins: counts.plugins, tools: counts.tools, skills: counts.skills }));
  }
  lines.push(t(locale, 'scope'), '');

  if (report.workspaceAgents.length) {
    lines.push(t(locale, 'workspaceAgents'));
    for (const a of report.workspaceAgents) {
      const status = t(locale, a.coreComplete ? 'agent.complete' : a.hasManifest ? 'agent.incomplete' : 'agent.none');
      lines.push(`  - ${a.name}  (${status})`);
    }
    lines.push('');
  }

  let section: AgentSurfaceSource | undefined;
  for (const p of report.plugins) {
    if (p.source && p.source !== section) {
      section = p.source;
      lines.push(`[${t(locale, `source.${p.source}`)}]`);
    }
    lines.push(`${p.pluginName}  [${p.packageRoot}]`);
    if (p.tools.length) lines.push(t(locale, 'tools', { list: p.tools.join(', ') }));
    if (p.skills.length) lines.push(t(locale, 'skills', { list: p.skills.join(', ') }));
    if (p.hooks.length) lines.push(t(locale, 'hooks', { list: p.hooks.join(', ') }));
    if (p.promptSections.length) lines.push(t(locale, 'promptSections', { list: p.promptSections.join(', ') }));
    if (p.subagents.length) lines.push(t(locale, 'subagents', { list: p.subagents.join(', ') }));
    if (p.hasAgentsMd) lines.push(t(locale, 'main'));
    if (p.evals.length) lines.push(t(locale, 'evals', { list: p.evals.join(', ') }));
    if (!p.tools.length && !p.skills.length && !p.hooks.length
      && !p.promptSections.length && !p.subagents.length && !p.evals.length && !p.hasAgentsMd) {
      lines.push(t(locale, 'empty'));
    }
    lines.push('');
  }

  if (!report.plugins.length && !report.workspaceAgents.length) {
    lines.push(t(locale, 'none'));
  }

  return lines.join('\n').trimEnd();
}
