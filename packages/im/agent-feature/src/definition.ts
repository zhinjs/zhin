import type { ValidationContext } from '@zhin.js/feature-kit';

const agentBrand = 'zhin.agent/1' as const;

export interface AgentDefinition {
  readonly $feature: typeof agentBrand;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

declare module '@zhin.js/plugin-runtime' {
  // Type parameter name must match the base PluginSetupContext declaration (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginSetupContext<TConfig> {
    addAgent(localName: string, markdown: string): void;
  }
}

export function parseAgentMarkdown(value: unknown, context: ValidationContext): AgentDefinition {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Agent ${context.source} must contain Markdown instructions`);
  }
  return Object.freeze({
    $feature: agentBrand,
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
