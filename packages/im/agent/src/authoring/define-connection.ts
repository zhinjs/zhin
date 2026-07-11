import { AUTHORING_KIND, type AuthoringConnectionDefinition, type ConnectionTransport } from './types.js';

export type DefineConnectionInput = Omit<AuthoringConnectionDefinition, typeof AUTHORING_KIND>;

export function defineConnection(input: DefineConnectionInput): AuthoringConnectionDefinition {
  return {
    [AUTHORING_KIND]: 'connection',
    ...input,
  };
}

export type { ConnectionTransport };
