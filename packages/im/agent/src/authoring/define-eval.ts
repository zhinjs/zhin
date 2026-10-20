import { AUTHORING_KIND, type AuthoringEvalDefinition, type AuthoringEvalContext } from './types.js';

export type { AuthoringEvalContext };

export type DefineEvalInput = Omit<AuthoringEvalDefinition, typeof AUTHORING_KIND>;

export function defineEval(input: DefineEvalInput): AuthoringEvalDefinition {
  return {
    [AUTHORING_KIND]: 'eval',
    ...input,
  };
}
