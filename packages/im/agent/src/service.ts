import type { AgentStartupConfig } from './config/agent-startup.js';
/**
 * AIService — AI 服务核心类
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */

import { type AITriggerConfig, type AIAccessConfig } from '@zhin.js/core';
import type { ContextConfig } from '@zhin.js/ai';
import { R2ImageAssetPublisher } from './media/r2-image-assets.js';
import type { ImageAssetPublisher, R2ImageStorageConfig } from './media/image-assets.js';
import { validateModelRuntimeConfig, findDeprecatedAgentBindingKeys, findDeprecatedAgentConfigKeys } from './config/index.js';
import { getLogger } from '@zhin.js/logger';
import { ModelRuntimeService } from './model-runtime/service.js';
import type { ModelRuntimeConfig, ModelRuntimeServiceOptions } from './model-runtime/types.js';
import { AgentBindingRegistry } from './config/agent-binding-registry.js';
import { resolvePerceptionSettings, type PerceptionSettings } from './config/perception-config.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import {
  PluginAILoopHookRegistry,
  type PluginAfterToolCallHandler,
  type PluginBeforeToolCallHandler,
  type PluginTransformContextHandler,
} from './plugin-loop-hooks.js';

const logger = getLogger('AIService');
export interface AIServiceConfig extends ModelRuntimeConfig {
  imageStorage?: R2ImageStorageConfig;
  /** Administrator-authored Console principal bindings; never inferred from a request body. */
  personalPrincipals?: Readonly<Record<string, readonly import('./personal-session/types.js').PersonalSessionOwner[]>>;
}
export class AIService {
  readonly imageAssets?: ImageAssetPublisher;
  private readonly sourceConfig: AIServiceConfig;
  private modelRuntime: ModelRuntimeService | null = null;
  private modelPreparation?: Promise<void>;
  private disposal?: Promise<void>;
  private closing = false;
  private bindingRegistry: AgentBindingRegistry;
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private accessConfig: AIAccessConfig;
  private agentConfig: AgentStartupConfig['agent'];
  private perceptionConfig?: PerceptionSettings;
  readonly loopHooks = new PluginAILoopHookRegistry();

  constructor(config: AIServiceConfig = {}) {
    const errors = validateModelRuntimeConfig(config, '');
    if (errors.length) throw new Error(errors.join('\n'));
    this.sourceConfig = config;
    this.imageAssets = config.imageStorage ? new R2ImageAssetPublisher(config.imageStorage) : undefined;
    this.bindingRegistry = new AgentBindingRegistry({ zhin: {}, ...config.agents });
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    this.accessConfig = config.access || {};
    this.agentConfig = config.agent;
    for (const { agent, key, reason } of findDeprecatedAgentBindingKeys(config.agents)) {
      logger.warn(`ai.agents.${agent}.${key} 已弃用，${reason}`);
    }
    for (const { key, reason } of findDeprecatedAgentConfigKeys(config.agent)) {
      logger.warn(`ai.agent.${key} 已弃用，${reason} 运行 zhin config check --fix 可移除。`);
    }
    this.perceptionConfig = config.multimodal?.perception
      ? resolvePerceptionSettings(config.multimodal.perception) : undefined;
  }


  /** Host supplies its namespace and execution ports before constructing Agent runtimes. */
  prepareModelRuntime(options: ModelRuntimeServiceOptions): Promise<void> {
    if (this.closing) return Promise.reject(new Error('AI service is disposed'));
    if (!this.modelPreparation) {
      // Sub-agents never take a binding's `purposes.agents` key (#1250). Only configured
      // bindings count: names merely discovered from agent files (setDiscoveredAgents) are
      // sub-agents as well and keep their own keys.
      this.modelRuntime = new ModelRuntimeService({
        ...options,
        bindingNames: options.bindingNames ?? (() => this.bindingRegistry.listConfiguredBindingNames()),
      });
      this.modelPreparation = Promise.resolve();
    }
    return this.modelPreparation;
  }

  getModelRuntime(): ModelRuntimeService {
    if (!this.modelRuntime) throw new Error('AI model runtime is not prepared');
    return this.modelRuntime;
  }

  /** Validated `ai.multimodal.perception`, or undefined when the pre-pass is off. */
  getPerceptionConfig(): PerceptionSettings | undefined {
    return this.perceptionConfig;
  }

  getBindingRegistry(): AgentBindingRegistry {
    return this.bindingRegistry;
  }

  /** 运行时合并 agents/<name>/agent.json 发现结果 */
  setDiscoveredAgents(fileMetas: import('./discovery/agents.js').AgentMeta[]): void {
    this.bindingRegistry = new AgentBindingRegistry({ zhin: {}, ...this.sourceConfig.agents }, fileMetas);
  }

  isReady(): boolean {
    return !this.closing && this.modelRuntime !== null;
  }

  /** ADR 0010 — bridge plugin beforeToolCall hooks to agentLoop. */
  onBeforeToolCall(handler: PluginBeforeToolCallHandler): () => void {
    return this.loopHooks.onBeforeToolCall(handler);
  }

  onAfterToolCall(handler: PluginAfterToolCallHandler): () => void {
    return this.loopHooks.onAfterToolCall(handler);
  }

  /** Run after built-in compaction in transformContext chain. */
  onTransformContext(handler: PluginTransformContextHandler): () => void {
    return this.loopHooks.onTransformContext(handler);
  }

  getContextConfig(): ContextConfig { return this.contextConfig; }
  getTriggerConfig(): AITriggerConfig { return this.triggerConfig; }
  getAccessConfig(): AIAccessConfig { return this.accessConfig; }
  /** 部署级 harness（execSecurity 等）；工具由编排 + TF-IDF + 角色（子 agent）选用 */
  getAgentConfig(): AgentStartupConfig['agent'] { return this.agentConfig; }

  /** `ai.context` history window settings (ADR 0043), for the Agent runtime. */
  getContextHistoryConfig(): { tokens?: ContextConfig['historyTokens']; maxMessages?: number | string } {
    return { tokens: this.contextConfig.historyTokens, maxMessages: this.contextConfig.maxRecentMessages };
  }


  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = this.disposeResources();
    return this.disposal;
  }

  private async disposeResources(): Promise<void> {
    await this.modelPreparation;
    await this.modelRuntime?.dispose();
  }

}

