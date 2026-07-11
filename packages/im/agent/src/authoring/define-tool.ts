import { AUTHORING_KIND, type AuthoringToolDefinition, type AuthoringToolContext } from './types.js';

export type { AuthoringToolContext };

export type DefineToolInput<TInput = Record<string, unknown>> = Omit<
  AuthoringToolDefinition<TInput>,
  typeof AUTHORING_KIND
>;

export function defineTool<TInput = Record<string, unknown>>(
  input: DefineToolInput<TInput>,
): AuthoringToolDefinition<TInput> {
  return {
    [AUTHORING_KIND]: 'tool',
    ...input,
  };
}
