import type { AIProvider, ImageGenerationDefaults } from '@zhin.js/ai';
import type { AgentToolDefinition } from '@zhin.js/tool';
import { NativeBashToolFeature } from './native-bash-tool.js';
import { createNativeFileToolFeatures } from './native-file-tools.js';
import { createNativeImageToolFeature } from './native-image-tool.js';
import { createNativeKnowledgeToolFeature, type KnowledgeIndex } from './native-knowledge-tool.js';
import { createNativeWebToolFeatures } from './native-web-tools.js';

export interface NativeAgentToolFeature {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export interface NativeAgentToolSuiteOptions {
  readonly resolveProvider: (alias: string) => AIProvider;
  readonly resolveImageDefaults?: (alias: string) => ImageGenerationDefaults;
  readonly knowledgeIndex?: KnowledgeIndex;
}

/** One canonical native Tool suite projected into both main and subagent runtimes. */
export function createNativeAgentToolSuite(
  options: NativeAgentToolSuiteOptions,
): readonly NativeAgentToolFeature[] {
  return Object.freeze([
    new NativeBashToolFeature(),
    ...createNativeFileToolFeatures(),
    ...createNativeWebToolFeatures(),
    createNativeImageToolFeature(options.resolveProvider, options.resolveImageDefaults),
    ...(options.knowledgeIndex
      ? [createNativeKnowledgeToolFeature(options.knowledgeIndex)]
      : []),
  ]);
}
