import { join } from 'node:path';
import type { AIService, McpServerEntry } from '@zhin.js/agent';
import {
  createNativeAgentToolSuite,
  createNativeInteractionToolFeatures,
  createNativeSemanticMemoryToolFeatures,
  createNativeTodoToolFeatures,
  FileTodoStore,
  projectHostMcp,
  projectHostTool,
  toolFeatureId,
  type KnowledgeIndex,
  type SemanticMemoryRuntime,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

type AddFeature = Parameters<RootResourceInstaller>[0]['addFeature'];

export interface HostAgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
  readonly source?: string;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  readonly requiresApproval?: 'always' | 'once' | 'never' | 'on-risk';
}

interface RuntimeToolFeature {
  readonly name: string;
  readonly definition: unknown;
}

export interface PublishAgentToolFeaturesOptions {
  readonly addFeature: AddFeature;
  readonly projectRoot: string;
  readonly service: AIService;
  readonly mcpServers: readonly McpServerEntry[];
  readonly hostTools?: readonly HostAgentTool[];
  readonly runtimeTools: readonly RuntimeToolFeature[];
  readonly knowledgeIndex?: KnowledgeIndex;
  readonly semanticMemory?: SemanticMemoryRuntime;
}

/** Publish every Host-owned Tool through one candidate-generation boundary. */
export function publishAgentToolFeatures(options: PublishAgentToolFeaturesOptions): void {
  for (const entry of options.mcpServers) {
    const projected = projectHostMcp(entry);
    options.addFeature(projected.feature, projected.name, projected.definition);
  }

  for (const tool of options.hostTools ?? []) {
    if (!tool.description.trim()) {
      throw new TypeError(`Host tool "${tool.name}" description cannot be empty`);
    }
    const projected = projectHostTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiresApproval: tool.requiresApproval,
      platforms: tool.platforms,
      scopes: tool.scopes,
      permissions: tool.permissions,
      hidden: tool.hidden,
      execute: (input) => tool.execute(input) as unknown | Promise<unknown>,
    });
    options.addFeature(projected.feature, projected.name, projected.definition);
  }

  for (const tool of options.runtimeTools) {
    options.addFeature(toolFeatureId, tool.name, tool.definition);
  }
  for (const tool of createNativeAgentToolSuite({
    resolveProvider: (alias) => options.service.getProvider(alias),
    resolveImageDefaults: (alias) => options.service.getImageGenerationDefaults(alias),
    knowledgeIndex: options.knowledgeIndex,
  })) {
    options.addFeature(toolFeatureId, tool.name, tool.definition);
  }
  for (const tool of createNativeTodoToolFeatures(
    new FileTodoStore(join(options.projectRoot, '.zhin', 'todos')),
  )) {
    options.addFeature(tool.feature, tool.name, tool.definition);
  }
  for (const tool of createNativeInteractionToolFeatures()) {
    options.addFeature(tool.feature, tool.name, tool.definition);
  }
  if (options.semanticMemory) {
    for (const tool of createNativeSemanticMemoryToolFeatures(options.semanticMemory)) {
      options.addFeature(tool.feature, tool.name, tool.definition);
    }
  }
}
