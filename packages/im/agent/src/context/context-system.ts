import { type AgentMessage, getLlmTransportModel } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { createDefaultContextBuilders } from './default-builders.js';
import type { BuildContext, ContextBuilder, ContextInjector, ContextSystemConfig, InjectContext } from './contracts.js';
import type { TurnEnvelopeParts } from './envelope-parts.js';
import {
  applyTurnContextToUserMessages,
  prependEnvelopeToFirstUserText,
} from './turn-user-message.js';
import { buildAgentsEnvelopeContext } from './agents-instruction.js';
import {
  buildTurnContextEnvelope,
  resolveQuoteSystemHint,
} from './turn-envelope.js';
import { resolveModelCandidates } from './model-resolver.js';
export type { TurnEnvelopeParts } from './envelope-parts.js';
export {
  ProfileContextBuilder,
  CollaborationContextBuilder,
  ToneInjector,
  createDefaultContextBuilders,
} from './default-builders.js';

export class ContextSystem {
  private builders: ContextBuilder[] = [];
  private injectors: ContextInjector[] = [];

  constructor(private readonly _config: ContextSystemConfig = {}) {}

  addBuilder(builder: ContextBuilder): void {
    this.builders.push(builder);
  }

  addInjector(injector: ContextInjector): void {
    this.injectors.push(injector);
  }

  private mergePipeline(
    host: ZhinAgentPrivate | undefined,
  ): { builders: ContextBuilder[]; injectors: ContextInjector[] } {
    if (!host) {
      return { builders: [...this.builders], injectors: [...this.injectors] };
    }
    const defaults = createDefaultContextBuilders(host);
    const builderNames = new Set(defaults.builders.map((b) => b.name));
    const injectorNames = new Set(defaults.injectors.map((i) => i.name));
    return {
      builders: [
        ...defaults.builders,
        ...this.builders.filter((b) => !builderNames.has(b.name)),
      ],
      injectors: [
        ...defaults.injectors,
        ...this.injectors.filter((i) => !injectorNames.has(i.name)),
      ],
    };
  }

  private async runPipeline(
    context: BuildContext,
    host?: ZhinAgentPrivate,
  ): Promise<AgentMessage[]> {
    const { builders, injectors } = this.mergePipeline(host ?? context.host);
    const built: AgentMessage[] = [];
    for (const builder of builders) {
      built.push(...await builder.build(context));
    }
    const injectCtx: InjectContext = {
      message: context.message,
      inboundContent: context.inboundContent,
      envelope: context.envelope,
    };
    return injectors.reduce(
      (messages, injector) => injector.inject(messages, injectCtx),
      built,
    );
  }

  /**
   * Builder/injector pipeline：内置 profile/collaboration/tone 写入 envelope；
   * 注册的 builder 可追加 AgentMessage[]。
   */
  async build(context: BuildContext): Promise<AgentMessage[]> {
    return this.runPipeline(context, context.host);
  }

  /** 生产 turn 路径：envelope 经 pipeline 收集，再组装 user 消息与模型候选。 */
  async buildTextTurnContext(input: TextTurnContextInput): Promise<TextTurnContextOutput> {
    const { host, commMessage, content, turnUser, deferredStats, prebuiltMessages } = input;
    const mode = input.mode ?? 'chat';
    const envelopeParts: Partial<TurnEnvelopeParts> = {};
    const buildCtx: BuildContext = {
      message: commMessage,
      inboundContent: content,
      host,
      envelope: envelopeParts,
    };

    const extraMessages = await this.runPipeline(buildCtx, host);
    const personaEnhanced = host.buildDisciplinedPrompt(host.config.persona);

    const modelCandidates = resolveModelCandidates(
      host.getTurnProvider().models,
      host.modelRegistry,
      host.getTurnProvider().name,
      host.config,
      mode === 'vision' ? 'vision' : 'chat',
    );
    const modelId = modelCandidates[0] || host.getTurnProvider().models[0] || 'gpt-4o-mini';
    const providerAlias = host.getTurnProvider().name;
    const llmModel = getLlmTransportModel(providerAlias, modelId);
    const agentsContext = await buildAgentsEnvelopeContext();

    const turnEnvelope = buildTurnContextEnvelope({
      commMessage,
      profileSummary: envelopeParts.profileSummary,
      toneHint: envelopeParts.toneHint,
      deferredStats,
      activeSkillsContext: host.getTurnActiveSkills() || undefined,
      quoteSystemHint: resolveQuoteSystemHint(commMessage),
      collaborationHint: envelopeParts.collaborationHint,
      modelLine: `${providerAlias}/${modelId}`,
      sdk: llmModel.sdk,
      agentsContext: agentsContext ?? undefined,
    });

    let userMessages = prebuiltMessages?.length
      ? prependEnvelopeToFirstUserText(prebuiltMessages, turnEnvelope)
      : applyTurnContextToUserMessages(turnUser.promptMessages, turnEnvelope);

    if (extraMessages.length > 0) {
      userMessages = [...extraMessages, ...userMessages];
    }

    return {
      userMessages,
      personaEnhanced,
      modelCandidates,
      modelId,
      providerAlias,
      turnEnvelope,
    };
  }
}

export interface TextTurnContextInput {
  host: ZhinAgentPrivate;
  commMessage: Message;
  content: string;
  turnUser: {
    rawContent: string;
    userMessageExtra?: import('@zhin.js/ai').AgentMessageExtra;
    promptMessages: import('@zhin.js/ai').UserMessage[];
  };
  deferredStats?: string;
  prebuiltMessages?: AgentMessage[];
  mode?: 'chat' | 'vision';
}

export interface TextTurnContextOutput {
  userMessages: AgentMessage[];
  personaEnhanced: string;
  modelCandidates: string[];
  modelId: string;
  providerAlias: string;
  turnEnvelope: string | null;
}

/** 每 host 独立实例 + 默认 builder/injector（与 toolSystem 一致，非全局单例）。 */
export function createContextSystemForHost(host: ZhinAgentPrivate): ContextSystem {
  const system = new ContextSystem();
  const { builders, injectors } = createDefaultContextBuilders(host);
  for (const builder of builders) system.addBuilder(builder);
  for (const injector of injectors) system.addInjector(injector);
  return system;
}
