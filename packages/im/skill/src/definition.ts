import type { ValidationContext } from '@zhin.js/feature-kit';

const skillBrand = 'zhin.skill/1' as const;

export interface SkillDefinition {
  readonly $feature: typeof skillBrand;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

declare module '@zhin.js/plugin-runtime' {
  // Type parameter name must match the base PluginSetupContext declaration (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginSetupContext<TConfig> {
    addSkill(localName: string, markdown: string): void;
  }
}

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
