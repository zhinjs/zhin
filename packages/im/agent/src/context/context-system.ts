import { type AgentMessage, type ModelInputModality, createUserMessage } from '@zhin.js/ai';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { createDefaultContextBuilders } from './default-builders.js';
import type { BuildContext, ContextBuilder, ContextInjector, ContextSystemConfig, InjectContext } from './contracts.js';
import type { TurnEnvelopeParts } from './envelope-parts.js';
import {
  appendTurnContextBlocks,
} from './turn-user-message.js';
import { buildAgentsEnvelopeContext } from './agents-instruction.js';
import { bootstrapSceneFromTurn, scopeBootstrapText } from '../bootstrap-scope.js';
import { buildPersonaSection } from '../prompt/system-prompt.js';
import {
  buildTurnContextBlocks,
  type TurnContextView,
} from './turn-envelope.js';
import { getGitStatusLine } from '../prompt/git-context.js';
import { getAgentTurnConfiguration } from '../turn/agent-turn-context.js';
import type { ContextFile } from '../bootstrap.js';
export type { TurnEnvelopeParts } from './envelope-parts.js';
export {
  ProfileContextBuilder,
  SessionContextBuilder,
  SceneEventsContextBuilder,
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
      turn: context.turn,
      inboundContent: context.inboundContent,
      envelope: context.envelope,
    };
    return injectors.reduce(
      (messages, injector) => injector.inject(messages, injectCtx),
      built,
    );
  }

  /**
   * Builder/injector pipeline：内置 profile/tone 写入 envelope；
   * 注册的 builder 可追加 AgentMessage[]。
   */
  async build(context: BuildContext): Promise<AgentMessage[]> {
    return this.runPipeline(context, context.host);
  }

  /** 生产 turn 路径：envelope 经 pipeline 收集，再组装 user 消息与模型候选。 */
  async buildTextTurnContext(input: TextTurnContextInput): Promise<TextTurnContextOutput> {
    const { host, turn, content, turnUser, deferredStats, prebuiltMessages } = input;
    const mode = input.mode ?? 'chat';
    const isScheduleTurn = turn.origin.kind === 'schedule';
    const envelopeParts: Partial<TurnEnvelopeParts> = {};
    const buildCtx: BuildContext = {
      turn,
      inboundContent: content,
      host,
      envelope: envelopeParts,
    };

    const extraMessages = isScheduleTurn ? [] : await this.runPipeline(buildCtx, host);
    // Rich turns assemble these same workspace files themselves. Tool-less turns use this
    // prepared persona, so its SOUL reference must include the already-loaded, scene-scoped text.
    // Delegated role prompts bypass ContextSystem and remain the caller's explicit persona.
    const systemBootstrap = input.systemBootstrap ?? (input.contextFiles === undefined ? host.bootstrapContext : '');
    const persona = !isScheduleTurn
      ? [
          buildPersonaSection({ config: host.config, bootstrapContext: systemBootstrap, contextFiles: input.contextFiles,
            turn, agentNickname: host.activeBinding?.nickname }),
          host.globalContext,
          scopeBootstrapText(systemBootstrap ?? '', bootstrapSceneFromTurn(turn), { contextFiles: input.contextFiles }).text,
        ].filter(text => text?.trim()).join('\n\n')
      : host.config.persona;
    // Final request assemblers own style/safety injection; context preparation only supplies content.
    const personaEnhanced = persona;

    const selected = host.getTurnExecution();
    const modelId = selected.model.id;
    const modelCandidates = [modelId];
    const providerAlias = selected.binding.account.id;
    const llmModel = selected.model;
    // Captured files decide root presence or absence (including []); never borrow a newer root from disk.
    const rootHandledBySystem = input.contextFiles !== undefined
      || /(?:^|\n)## (?:AGENTS|BOT)\.md\n/u.test((!isScheduleTurn ? systemBootstrap : input.systemBootstrap) ?? '');
    const agentsContext = await buildAgentsEnvelopeContext(undefined, bootstrapSceneFromTurn(turn), { excludeRoot: rootHandledBySystem });

    // Schedule ingress provides one current task; never infer its author from a history tail.
    const scheduleInput = isScheduleTurn && turnUser.promptMessages.length === 1 ? turnUser.promptMessages[0] : undefined;
    const preparedMessages = isScheduleTurn
      ? [createUserMessage(content, undefined, scheduleInput?.timestamp, scheduleInput?.actor, scheduleInput?.cause)]
      : prebuiltMessages?.length ? prebuiltMessages : turnUser.promptMessages;
    const first = preparedMessages[0]?.role === 'user' ? preparedMessages[0] as import('@zhin.js/ai').UserMessage : undefined;
    const turnBlocks = buildTurnContextBlocks({
      turn,
      fallbackNickname: host.activeBinding?.nickname,
      observedAt: first?.timestamp,
      profileSummary: envelopeParts.profileSummary,
      sessionSummary: envelopeParts.sessionSummary,
      sceneEvents: envelopeParts.sceneEvents,
      toneHint: envelopeParts.toneHint,
      deferredStats,
      activeSkillsContext: (input.activeSkillsContext ?? host.getTurnActiveSkills()) || undefined,
      activeSkillBlocks: input.activeSkillBlocks,
      quoteSystemHint: input.quoteSystemHint,
      gitStatus: !isScheduleTurn && host.config.gitStatus ? await getGitStatusLine(process.cwd()) : undefined,
      agentsContext: agentsContext ?? undefined,
      toldLedger: input.toldLedger,
      toldLedgerBlocks: input.toldLedgerBlocks,
      relevantMemory: input.relevantMemory,
    });

    const turnEnvelope = turnBlocks.map(block => block.text).join('\n');
    let userMessages = appendTurnContextBlocks(
      preparedMessages,
      turnBlocks,
      isScheduleTurn ? undefined : turnUser.userMessageExtra,
    );

    if (extraMessages.length > 0) {
      userMessages = [...extraMessages, ...userMessages];
    }

    return {
      userMessages,
      personaEnhanced,
      modelCandidates,
      modelId,
      providerAlias,
      modelSdk: llmModel.promptFamily,
      modelInput: Object.freeze(Array.isArray(llmModel.input) ? [...llmModel.input] : ['text']),
      turnEnvelope,
    };
  }
}

export interface TextTurnContextInput {
  host: ZhinAgentPrivate;
  turn: TurnContextView;
  content: string;
  turnUser: {
    rawContent: string;
    userMessageExtra?: import('@zhin.js/ai').AgentMessageExtra;
    promptMessages: import('@zhin.js/ai').UserMessage[];
  };
  deferredStats?: string;
  /** The bootstrap text the system prompt of this turn actually carries (host `## <file>` sections). */
  systemBootstrap?: string;
  contextFiles?: readonly ContextFile[];
  quoteSystemHint?: string;
  prebuiltMessages?: AgentMessage[];
  mode?: 'chat' | 'vision';
  activeSkillsContext?: string;
  activeSkillBlocks?: readonly import('@zhin.js/ai').TextContentBlock[];
  /** Rendered "already told the user" ledger for this session (#730). */
  toldLedger?: string;
  toldLedgerBlocks?: readonly import('@zhin.js/ai').TextContentBlock[];
  /** BM25-recalled semantic memory for this message (#734). */
  relevantMemory?: string;
}

export interface TextTurnContextOutput {
  userMessages: AgentMessage[];
  personaEnhanced: string;
  modelCandidates: string[];
  modelId: string;
  providerAlias: string;
  modelSdk?: string;
  modelInput: readonly ModelInputModality[];
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
