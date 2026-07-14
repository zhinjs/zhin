import { AUTHORING_KIND, type AuthoringStateDefinition } from './types.js';

export type DefineStateInput<T = unknown> = Omit<AuthoringStateDefinition<T>, typeof AUTHORING_KIND | 'runtimeName'>;

export function defineState<T = unknown>(input: DefineStateInput<T>): AuthoringStateDefinition<T> {
  return {
    [AUTHORING_KIND]: 'state',
    ...input,
  };
}
