import type { ValidationContext } from '@zhin.js/feature-kit';

const agentBrand = 'zhin.agent/1' as const;
const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ENTRY_POINT = /^[a-z0-9][a-z0-9._-]*\.md$/u;
const REQUIRED_ENTRY_POINTS = ['system.md', 'boundaries.md', 'conventions.md'] as const;

export type AgentScope = 'private' | 'group' | 'channel';

export interface AgentTriggerRules {
  readonly filePatterns: readonly string[];
  readonly keywords: readonly string[];
}

export interface AgentResource {
  readonly path: string;
  readonly content: string;
}

export interface AgentPackageSource {
  readonly manifest: unknown;
  readonly files: Readonly<Record<string, string>>;
  readonly workflows: readonly AgentResource[];
  readonly knowledge: readonly AgentResource[];
  readonly privateToolNames?: readonly string[];
  readonly privateSkillNames?: readonly string[];
}

export interface AgentDefinition {
  readonly $feature: typeof agentBrand;
  /** Stable capability id derived from agents/<name>/. */
  readonly name: string;
  /** Human-readable name declared by agent.json. */
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly triggerRules: AgentTriggerRules;
  readonly entryPoints: readonly string[];
  readonly instructions: string;
  readonly workflows: readonly AgentResource[];
  readonly knowledge: readonly AgentResource[];
  readonly toolNames?: readonly string[];
  readonly skillNames?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly tags?: readonly string[];
  readonly role?: string;
  readonly contextMode?: 'fork' | 'fresh';
  readonly maxIterations?: number;
  readonly model?: string;
  readonly provider?: string;
  readonly effort?: 'low' | 'medium' | 'high' | 'max';
  readonly memory?: 'user' | 'session' | 'agent';
  readonly platforms?: readonly string[];
  readonly scopes?: readonly AgentScope[];
  readonly permissions?: readonly string[];
}

interface AgentManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly trigger_rules: {
    readonly file_patterns?: readonly string[];
    readonly keywords?: readonly string[];
  };
  readonly entry_points: readonly string[];
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly disallowed_tools?: readonly string[];
  readonly tags?: readonly string[];
  readonly role?: string;
  readonly context_mode?: 'fork' | 'fresh';
  readonly max_iterations?: number;
  readonly model?: string;
  readonly provider?: string;
  readonly effort?: 'low' | 'medium' | 'high' | 'max';
  readonly memory?: 'user' | 'session' | 'agent';
  readonly platforms?: readonly string[];
  readonly scopes?: readonly AgentScope[];
  readonly permissions?: readonly string[];
}

export function parseAgentPackage(value: unknown, context: ValidationContext): AgentDefinition {
  if (!isRecord(value)) throw new TypeError(`Agent ${context.source} must be a package source`);
  const source = value as unknown as AgentPackageSource;
  const manifest = parseManifest(source.manifest, context);
  if (!AGENT_NAME.test(context.localName)) {
    throw new TypeError(`Agent directory ${context.localName} must use lowercase kebab-case`);
  }
  const files = isRecord(source.files) ? source.files : {};
  const entryPoints = stringList(manifest.entry_points, 'entry_points', true);
  for (const required of REQUIRED_ENTRY_POINTS) {
    if (!entryPoints.includes(required)) {
      throw new TypeError(`Agent ${context.source} entry_points must include ${required}`);
    }
  }
  for (const entry of entryPoints) {
    if (!ENTRY_POINT.test(entry)) {
      throw new TypeError(`Agent ${context.source} entry point must be a root Markdown file: ${entry}`);
    }
    if (typeof files[entry] !== 'string' || !files[entry].trim()) {
      throw new TypeError(`Agent ${context.source} entry point is missing or empty: ${entry}`);
    }
  }
  const workflows = resources(source.workflows, 'workflows');
  const knowledge = resources(source.knowledge, 'knowledge');
  return Object.freeze({
    $feature: agentBrand,
    name: context.localName,
    displayName: nonEmptyText(manifest.name, 'name'),
    version: semanticVersion(manifest.version),
    description: nonEmptyText(manifest.description, 'description'),
    triggerRules: Object.freeze({
      filePatterns: stringList(manifest.trigger_rules.file_patterns ?? [], 'trigger_rules.file_patterns'),
      keywords: stringList(manifest.trigger_rules.keywords ?? [], 'trigger_rules.keywords'),
    }),
    entryPoints,
    instructions: assembleInstructions(entryPoints, files, workflows, knowledge),
    workflows,
    knowledge,
    toolNames: combinedNames(manifest.tools, source.privateToolNames, 'tools'),
    skillNames: combinedNames(manifest.skills, source.privateSkillNames, 'skills'),
    disallowedTools: optionalStringList(manifest.disallowed_tools, 'disallowed_tools'),
    tags: optionalStringList(manifest.tags, 'tags'),
    role: optionalText(manifest.role, 'role'),
    contextMode: optionalEnum(manifest.context_mode, 'context_mode', ['fork', 'fresh']),
    maxIterations: optionalPositiveInteger(manifest.max_iterations, 'max_iterations'),
    model: optionalText(manifest.model, 'model'),
    provider: optionalText(manifest.provider, 'provider'),
    effort: optionalEnum(manifest.effort, 'effort', ['low', 'medium', 'high', 'max']),
    memory: optionalEnum(manifest.memory, 'memory', ['user', 'session', 'agent']),
    platforms: optionalStringList(manifest.platforms, 'platforms'),
    scopes: optionalScopes(manifest.scopes),
    permissions: optionalStringList(manifest.permissions, 'permissions'),
  });
}

function assembleInstructions(
  entryPoints: readonly string[],
  files: Readonly<Record<string, unknown>>,
  workflows: readonly AgentResource[],
  knowledge: readonly AgentResource[],
): string {
  const sections = entryPoints.map((entry) => `## ${entry}\n\n${String(files[entry]).trim()}`);
  for (const resource of [...workflows, ...knowledge]) {
    sections.push(`## ${resource.path}\n\n${resource.content.trim()}`);
  }
  return sections.join('\n\n');
}

function parseManifest(value: unknown, context: ValidationContext): AgentManifest {
  if (!isRecord(value)) throw new TypeError(`Agent ${context.source} agent.json must contain an object`);
  const allowed = new Set([
    'name', 'version', 'description', 'trigger_rules', 'entry_points', 'tools', 'skills',
    'disallowed_tools', 'tags', 'role', 'context_mode', 'max_iterations', 'model',
    'provider', 'effort', 'memory', 'platforms', 'scopes', 'permissions',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`Agent ${context.source} agent.json has unknown fields: ${unknown.join(', ')}`);
  if (!isRecord(value.trigger_rules)) {
    throw new TypeError(`Agent ${context.source} trigger_rules must be an object`);
  }
  const triggerUnknown = Object.keys(value.trigger_rules)
    .filter((key) => key !== 'file_patterns' && key !== 'keywords');
  if (triggerUnknown.length) {
    throw new TypeError(`Agent ${context.source} trigger_rules has unknown fields: ${triggerUnknown.join(', ')}`);
  }
  return value as unknown as AgentManifest;
}

function resources(value: unknown, field: string): readonly AgentResource[] {
  if (!Array.isArray(value)) throw new TypeError(`Agent package ${field} must be an array`);
  return Object.freeze(value.map((item) => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.content !== 'string') {
      throw new TypeError(`Agent package ${field} entries must contain path and content strings`);
    }
    return Object.freeze({ path: item.path, content: item.content });
  }));
}

function stringList(value: unknown, field: string, required = false): readonly string[] {
  if (!Array.isArray(value) || (required && value.length === 0)
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TypeError(`Agent agent.json ${field} must contain non-empty strings`);
  }
  const normalized = value.map((entry) => String(entry).trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`Agent agent.json ${field} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

function optionalStringList(value: unknown, field: string): readonly string[] | undefined {
  return value === undefined ? undefined : stringList(value, field);
}

function combinedNames(
  declared: unknown,
  discovered: readonly string[] | undefined,
  field: string,
): readonly string[] | undefined {
  const values = [...(optionalStringList(declared, field) ?? []), ...(discovered ?? [])];
  return values.length ? Object.freeze([...new Set(values)]) : undefined;
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Agent agent.json ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : nonEmptyText(value, field);
}

function semanticVersion(value: unknown): string {
  const version = nonEmptyText(value, 'version');
  if (!VERSION.test(version)) throw new TypeError('Agent agent.json version must be semantic version');
  return version;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new TypeError(`Agent agent.json ${field} must be a positive integer`);
  }
  return Number(value);
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`Agent agent.json ${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function optionalScopes(value: unknown): readonly AgentScope[] | undefined {
  const scopes = optionalStringList(value, 'scopes');
  if (scopes?.some((scope) => scope !== 'private' && scope !== 'group' && scope !== 'channel')) {
    throw new TypeError('Agent agent.json scopes must be private, group, or channel');
  }
  return scopes as readonly AgentScope[] | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
