/**
 * Skill Markdown parsing API consumed from `@zhin.js/skill`.
 * @module @zhin.js/skill
 */
import type { ValidationContext } from '@zhin.js/feature-kit';
import { load as loadYaml } from 'js-yaml';

const skillBrand = 'zhin.skill/1' as const;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export type SkillScope = 'private' | 'group' | 'channel';

export interface SkillDefinition {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof skillBrand;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly toolNames?: readonly string[];
  readonly platforms?: readonly string[];
  readonly scopes?: readonly SkillScope[];
  readonly permissions?: readonly string[];
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly always?: boolean;
  /** @internal Parent Agent for an Agent-private Skill. */
  readonly agentName?: string;
}

interface SkillPackageSource {
  readonly markdown: string;
  readonly privateToolNames?: readonly string[];
}

declare module '@zhin.js/plugin-runtime' {
  // Type parameter name must match the base PluginSetupContext declaration (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginSetupContext<TConfig = unknown> {
    addSkill(localName: string, markdown: string): void;
  }
}

/**
 * Parse a convention-loaded Skill Markdown file into its immutable runtime form.
 * The first Markdown heading becomes the user-facing description.
 *
 * @public
 * @experimental
 */
export function parseSkillMarkdown(value: unknown, context: ValidationContext): SkillDefinition {
  const source = typeof value === 'string'
    ? { markdown: value, privateToolNames: [] }
    : isSkillPackageSource(value) ? value : undefined;
  if (!source || !source.markdown.trim()) {
    throw new TypeError(`Skill ${context.source} must contain Markdown instructions`);
  }
  const parsed = parseFrontmatter(source.markdown, context);
  const name = context.localName.split('/').at(-1)!;
  const declaredTools = optionalStringList(parsed.metadata.tools, 'tools') ?? [];
  const toolNames = unique([...declaredTools, ...(source.privateToolNames ?? [])]);
  return Object.freeze({
    $feature: skillBrand,
    name,
    description: optionalText(parsed.metadata.description, 'description')
      ?? markdownSummary(parsed.instructions, name),
    instructions: parsed.instructions,
    toolNames: toolNames.length ? Object.freeze(toolNames) : undefined,
    platforms: optionalStringList(parsed.metadata.platforms, 'platforms'),
    scopes: optionalScopes(parsed.metadata.scopes),
    permissions: optionalStringList(parsed.metadata.permissions, 'permissions'),
    keywords: optionalStringList(parsed.metadata.keywords, 'keywords'),
    tags: optionalStringList(parsed.metadata.tags, 'tags'),
    always: optionalBoolean(parsed.metadata.always, 'always'),
    ...(agentName(context.localName) ? { agentName: agentName(context.localName) } : {}),
  });
}

function agentName(localName: string): string | undefined {
  const segments = localName.split('/');
  return segments[0] === 'agent' && segments.length === 3 ? segments[1] : undefined;
}

function parseFrontmatter(markdown: string, context: ValidationContext): {
  metadata: Record<string, unknown>;
  instructions: string;
} {
  const match = FRONTMATTER.exec(markdown);
  if (!match) return { metadata: {}, instructions: markdown };
  const loaded = loadYaml(match[1] ?? '');
  if (loaded !== undefined && (!loaded || typeof loaded !== 'object' || Array.isArray(loaded))) {
    throw new TypeError(`Skill ${context.source} frontmatter must be an object`);
  }
  const metadata = (loaded ?? {}) as Record<string, unknown>;
  const declaredName = optionalText(metadata.name, 'name');
  const directoryName = context.localName.split('/').at(-1)!;
  if (declaredName && declaredName !== directoryName) {
    throw new TypeError(
      `Skill ${context.source} name ${declaredName} must match directory ${directoryName}`,
    );
  }
  const instructions = markdown.slice(match[0].length).trim();
  if (!instructions) throw new TypeError(`Skill ${context.source} must contain Markdown instructions`);
  return { metadata, instructions };
}

function isSkillPackageSource(value: unknown): value is SkillPackageSource {
  return typeof value === 'object' && value !== null
    && typeof (value as SkillPackageSource).markdown === 'string'
    && ((value as SkillPackageSource).privateToolNames === undefined
      || Array.isArray((value as SkillPackageSource).privateToolNames));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Skill frontmatter ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TypeError(`Skill frontmatter ${field} must contain non-empty strings`);
  }
  return Object.freeze(value.map((entry) => String(entry).trim()));
}

function optionalScopes(value: unknown): readonly SkillScope[] | undefined {
  const scopes = optionalStringList(value, 'scopes');
  if (scopes?.some((scope) => scope !== 'private' && scope !== 'group' && scope !== 'channel')) {
    throw new TypeError('Skill frontmatter scopes must be private, group, or channel');
  }
  return scopes as readonly SkillScope[] | undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TypeError(`Skill frontmatter ${field} must be a boolean`);
  return value;
}

function markdownSummary(markdown: string, fallback: string): string {
  const line = markdown.split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => /^#+\s+\S/u.test(value));
  return line?.replace(/^#+\s*/u, '') ?? fallback;
}
