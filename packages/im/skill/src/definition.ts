/**
 * Skill Markdown parsing API consumed from `@zhin.js/skill`.
 * @module @zhin.js/skill
 */
import type { ValidationContext } from '@zhin.js/feature-kit';

const skillBrand = 'zhin.skill/1' as const;

export interface SkillDefinition {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof skillBrand;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
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
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Skill ${context.source} must contain Markdown instructions`);
  }
  return Object.freeze({
    $feature: skillBrand,
    name: context.localName,
    description: markdownSummary(value, context.localName),
    instructions: value,
  });
}

function markdownSummary(markdown: string, fallback: string): string {
  const line = markdown.split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => /^#+\s+\S/u.test(value));
  return line?.replace(/^#+\s*/u, '') ?? fallback;
}
