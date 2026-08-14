import type { PromptAssemblyRegistry } from './prompt-assembly-registry.js';

export const promptAssemblyToken = Symbol.for('@zhin.js/agent:prompt-assembly');
export type PromptAssemblyToken = typeof promptAssemblyToken;

export interface PromptAssemblyResource {
  registry: PromptAssemblyRegistry;
  token: PromptAssemblyToken;
}
