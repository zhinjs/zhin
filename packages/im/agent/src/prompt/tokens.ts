import { createToken } from '@zhin.js/plugin-runtime';
import type { PromptSegment } from './segments/types.js';
import type { PromptAssemblyRegistry } from './prompt-assembly-registry.js';

export const promptAssemblyToken = Symbol.for('@zhin.js/agent:prompt-assembly');
export type PromptAssemblyToken = typeof promptAssemblyToken;

export interface PromptAssemblyResource {
  registry: PromptAssemblyRegistry;
  token: PromptAssemblyToken;
}

/**
 * ADR 0041 §3: a plugin contributes prompt segments by providing one segment (or a list) on its
 * Scope. The value lives and dies with the plugin's generation, so the segments disappear when the
 * generation is replaced. Segment ids must be unique across the whole prompt (a clash throws).
 */
export const promptSegmentToken = createToken<PromptSegmentSource>('zhin.agent.prompt-segments');
export type PromptSegmentSource = PromptSegment | readonly PromptSegment[];

export function promptSegmentsOf(source: unknown): readonly PromptSegment[] {
  if (!source) return [];
  return Array.isArray(source) ? source : [source as PromptSegment];
}
