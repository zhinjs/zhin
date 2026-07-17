import type { ValidationContext } from '@zhin.js/next-feature-kit';

const skillBrand = 'zhin.skill/1' as const;

export interface SkillDefinition {
  readonly $feature: typeof skillBrand;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
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
