import { AUTHORING_KIND, type AuthoringToolDefinition, type AuthoringToolContext } from './types.js';

export type { AuthoringToolContext };

export type DefineAgentToolInput<TInput = Record<string, unknown>> = Omit<
  AuthoringToolDefinition<TInput>,
  typeof AUTHORING_KIND
>;

/** @deprecated Use {@link DefineAgentToolInput} */
export type DefineToolInput<TInput = Record<string, unknown>> = DefineAgentToolInput<TInput>;

/**
 * Define a file-based agent tool under `agent/tools/*.ts` (Eve-aligned authoring surface).
 * Prefer this over programmatic `plugin.addTool` for plugin-packaged AI tools.
 */
export function defineAgentTool<TInput = Record<string, unknown>>(
  input: DefineAgentToolInput<TInput>,
): AuthoringToolDefinition<TInput> {
  return {
    [AUTHORING_KIND]: 'tool',
    ...input,
  };
}

/**
 * @deprecated Use {@link defineAgentTool}. Kept as a soft alias for existing plugins.
 */
export function defineTool<TInput = Record<string, unknown>>(
  input: DefineAgentToolInput<TInput>,
): AuthoringToolDefinition<TInput> {
  return defineAgentTool(input);
}
