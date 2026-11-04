import type { InferenceClient } from '@zhin.js/ai/provider';
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
import { createNativeSelfProfileToolFeatures } from './native-self-profile-tools.js';

export interface NativeAgentToolFeature {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

export interface NativeAgentToolSuiteOptions {
  readonly resolveInference: () => InferenceClient;
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
    ...createNativeSelfProfileToolFeatures({ imageAssets: options.imageAssets, localAssets: options.localAssets }),
    createNativeImageToolFeature({ resolveInference: options.resolveInference, imageAssets: options.imageAssets }),
    ...(options.imageAssets ? [createNativeImageUploadToolFeature(options.imageAssets)] : []),
    ...(options.localAssets ? [createNativeLocalAssetsToolFeature(options.localAssets)] : []),
    ...(options.knowledgeIndex
      ? [createNativeKnowledgeToolFeature(options.knowledgeIndex, options.resolveDecision)]
      : []),
  ]);
}
