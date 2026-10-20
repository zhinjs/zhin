import { AUTHORING_KIND, type AuthoringHookDefinition } from './types.js';

export type DefineHookInput = Omit<AuthoringHookDefinition, typeof AUTHORING_KIND>;

export function defineHook(input: DefineHookInput): AuthoringHookDefinition {
  return {
    [AUTHORING_KIND]: 'hook',
    ...input,
  };
}
