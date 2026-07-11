import { AUTHORING_KIND, type AuthoringAgentDefinition } from './types.js';

export type DefineAgentInput = Omit<AuthoringAgentDefinition, typeof AUTHORING_KIND>;

export function defineAgent(input: DefineAgentInput): AuthoringAgentDefinition {
  return {
    [AUTHORING_KIND]: 'agent',
    ...input,
  };
}
