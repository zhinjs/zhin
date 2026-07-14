import { AUTHORING_KIND, type AuthoringDynamicDefinition } from './types.js';

export type DefineDynamicInput = Omit<AuthoringDynamicDefinition, typeof AUTHORING_KIND>;

export function defineDynamic(input: DefineDynamicInput): AuthoringDynamicDefinition {
  return {
    [AUTHORING_KIND]: 'dynamic',
    ...input,
  };
}
