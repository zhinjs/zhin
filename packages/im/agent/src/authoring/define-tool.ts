import type { RegisteredAdapterName } from '@zhin.js/tool';
import { AUTHORING_KIND, type AuthoringToolDefinition, type AuthoringToolContext } from './types.js';

export type { AuthoringToolContext };

export type DefineAgentToolInput<TInput = Record<string, unknown>> =
  | Omit<AuthoringToolDefinition<TInput, undefined>, typeof AUTHORING_KIND>
  | {
      [TAdapter in RegisteredAdapterName]: Omit<
        AuthoringToolDefinition<TInput, TAdapter>,
        typeof AUTHORING_KIND
      > & { readonly adapter: TAdapter }
    }[RegisteredAdapterName];

/**
 * Define an explicit file-based Agent Tool entry under `agent/tools/$*.ts`.
 */
export function defineAgentTool<TInput = Record<string, unknown>>(
  input: DefineAgentToolInput<TInput>,
): AuthoringToolDefinition<TInput, string | undefined> {
  const adapter = (input as { readonly adapter?: unknown }).adapter;
  if (adapter !== undefined
    && (typeof adapter !== 'string' || adapter.trim() === '')) {
    throw new TypeError('Agent Tool adapter must be a non-empty string');
  }
  if (typeof adapter === 'string' && input.platforms
    && (input.platforms.length !== 1 || input.platforms[0] !== adapter)) {
    throw new TypeError('Agent Tool adapter and platforms must select the same single adapter');
  }
  return {
    [AUTHORING_KIND]: 'tool',
    ...input,
    platforms: typeof adapter === 'string' ? [adapter] : input.platforms,
  };
}
