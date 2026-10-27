import type { AIProvider, ImageGenerationDefaults } from '@zhin.js/ai';
import type { AgentToolDefinition } from '@zhin.js/tool';
import { NativeBashToolFeature } from './native-bash-tool.js';
import { createNativeFileToolFeatures } from './native-file-tools.js';
import { createNativeImageToolFeature } from './native-image-tool.js';
import { createNativeImageUploadToolFeature } from './native-image-upload-tool.js';
import type { ImageAssetPublisher } from '../media/image-assets.js';
import type { LocalImageAssetStore } from '../media/local-image-assets.js';
import { createNativeLocalAssetsToolFeature } from './native-local-assets-tool.js';
import { createNativeKnowledgeToolFeature, type KnowledgeIndex } from './native-knowledge-tool.js';
import { createNativeWebToolFeatures } from './native-web-tools.js';
import type { NativeSearchDecisionResolver } from '../decision/retrieval.js';

export interface NativeAgentToolFeature {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

export interface NativeAgentToolSuiteOptions {
  readonly resolveProvider: (alias: string) => AIProvider;
  readonly resolveImageDefaults?: (alias: string) => ImageGenerationDefaults;
  readonly imageAssets?: ImageAssetPublisher;
  readonly localAssets?: LocalImageAssetStore;
  readonly knowledgeIndex?: KnowledgeIndex;
  readonly resolveDecision?: NativeSearchDecisionResolver;
}

/** One canonical native Tool suite projected into both main and subagent runtimes. */
export function createNativeAgentToolSuite(
  options: NativeAgentToolSuiteOptions,
): readonly NativeAgentToolFeature[] {
  return Object.freeze([
    new NativeBashToolFeature(),
    ...createNativeFileToolFeatures(),
    ...createNativeWebToolFeatures(),
    createNativeImageToolFeature(options.resolveProvider, options.resolveImageDefaults, options.imageAssets),
    ...(options.imageAssets ? [createNativeImageUploadToolFeature(options.imageAssets)] : []),
    ...(options.localAssets ? [createNativeLocalAssetsToolFeature(options.localAssets)] : []),
    ...(options.knowledgeIndex
      ? [createNativeKnowledgeToolFeature(options.knowledgeIndex, options.resolveDecision)]
      : []),
  ]);
}
