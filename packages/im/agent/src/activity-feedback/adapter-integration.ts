/**
 * Activity Feedback — endpoint 适配器集成（复用 typing-indicator 底层适配器）
 */

import { getLogger } from '@zhin.js/logger';
import type { Adapter, Endpoint, SendOptions } from '@zhin.js/core';
import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';
import { createGenerationStore, type GenerationStoreContext } from '@zhin.js/plugin-runtime';
import {
  MessageTypingIndicator,
  NativeTypingIndicator,
  NoneTypingIndicator,
  ReactionTypingIndicator,
  type TypingIndicator,
  type TypingIndicatorAdapter,
  type TypingIndicatorConfig,
  type TypingIndicatorOptions,
} from '../typing-indicator/index.js';
import {
  PLATFORM_FEATURES,
  buildTypingSendContent,
  type PlatformFeatures,
  type BotWithEditing,
} from '../typing-indicator/adapter-integration.js';
import { ActivityFeedbackManager } from './manager.js';
import type { ActivityFeedbackPhase, ResolvedActivityFeedbackPhaseConfig } from './types.js';

const logger = getLogger('ActivityFeedback');

export { PLATFORM_FEATURES, buildTypingSendContent, type PlatformFeatures };

type OutboundAdapter = Pick<Adapter, 'sendMessage'>;

function resolveSendTarget(options: TypingIndicatorOptions): { type: 'private' | 'group'; id: string } {
  if ((options.sceneType === 'group' || options.sceneType === 'channel') && options.groupId) {
    return { type: 'group', id: options.groupId };
  }
  if (options.sceneType === 'private') {
    if (options.groupId) {
      return { type: 'private', id: options.groupId };
    }
    if (options.userId) {
      return { type: 'private', id: options.userId };
    }
  }
  const parts = (options.sessionId ?? '').split(':').filter((p) => p.length > 0);
  if (parts.length >= 3) return { type: 'group', id: parts[1]! };
  if (parts.length >= 2) return { type: 'private', id: parts[parts.length - 1]! };
  return { type: 'private', id: options.sessionId ?? '' };
}

function createOutboundSendMessage(
  endpoint: Endpoint,
  platform: string,
  messages: Map<string, MessageRef>,
  outbound?: OutboundAdapter,
): (options: TypingIndicatorOptions, content: string) => Promise<string | null> {
  return async (options, content) => {
    try {
      const segments = buildTypingSendContent(platform, options, content);
      if (!segments) return null;
      const { type, id } = resolveSendTarget(options);
      const sendOptions: SendOptions = {
        type,
        id,
        context: platform,
        endpoint: endpoint.$id,
        content: segments,
      };
      if (outbound) {
        const messageId = await outbound.sendMessage(sendOptions);
        if (messageId) messages.set(messageId, toMessageRef(endpoint, platform, options, messageId));
        return messageId;
      }
      logger.error(`[${platform}] Activity feedback requires Adapter.sendMessage; endpoint ${endpoint.$id} has no outbound adapter`);
      return null;
    } catch (error) {
      logger.error(`[${platform}] Failed to send activity feedback message:`, error);
      return null;
    }
  };
}

export interface PlatformActivityFeedbackStartOptions {
  messageId?: string;
  sessionId: string;
  userId?: string;
  groupId?: string;
  sceneType: 'private' | 'group';
  phase?: ActivityFeedbackPhase;
  /** 由 service 插件策略层解析；adapter 不再自行 resolve */
  phaseConfig: ResolvedActivityFeedbackPhaseConfig;
}

/** 平台自管 Activity Feedback IO（如 ICQQ 群临时私聊 parent） */
export interface PlatformActivityFeedbackManager {
  start(options: PlatformActivityFeedbackStartOptions): Promise<unknown>;
  stop(options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
    phase?: ActivityFeedbackPhase;
  }): Promise<void>;
  getActiveIndicator?(
    phase: ActivityFeedbackPhase,
    options: TypingIndicatorOptions,
  ): TypingIndicator | undefined;
}

export type BotActivityFeedbackManager = ActivityFeedbackManager | PlatformActivityFeedbackManager;

export interface EndpointWithActivityFeedback extends Endpoint {
  $activityFeedback?: BotActivityFeedbackManager;
}

function registerPlatformAdapters(
  manager: ActivityFeedbackManager,
  endpoint: EndpointWithActivityFeedback,
  platform: string,
  outbound?: OutboundAdapter,
): void {
  const messages = new Map<string, MessageRef>();
  const sendMessage = createOutboundSendMessage(endpoint, platform, messages, outbound);
  manager.registerAdapter(new EndpointActivityFeedbackAdapter(
    platform,
    endpoint,
    messages,
    sendMessage,
  ));
}

/** One adapter selected from the concrete Endpoint control contract, not its platform name. */
class EndpointActivityFeedbackAdapter implements TypingIndicatorAdapter {
  readonly supportedTypes: import('../typing-indicator/index.js').TypingIndicatorType[];

  constructor(
    readonly platform: string,
    private readonly endpoint: EndpointWithActivityFeedback,
    private readonly messages: Map<string, MessageRef>,
    private readonly sendMessage: (options: TypingIndicatorOptions, content: string) => Promise<string | null>,
  ) {
    const types: import('../typing-indicator/index.js').TypingIndicatorType[] = [];
    if (endpoint.control?.addReaction && endpoint.control.removeReaction) types.push('reaction');
    if (endpoint.control?.typing) types.push('typing');
    // Activity messages are transient state, so advertising them without a
    // matching recall operation would leave permanent “processing” debris in IM.
    if (endpoint.control?.recall) types.push('message');
    types.push('none');
    this.supportedTypes = types;
  }

  createIndicator(options: TypingIndicatorOptions, config: TypingIndicatorConfig): TypingIndicator {
    if (config.type === 'reaction' && this.endpoint.control?.addReaction && this.endpoint.control.removeReaction) {
      return new ReactionTypingIndicator(
        options,
        config,
        async (messageId, emoji, current) => {
          const message = toMessageRef(this.endpoint, this.platform, current, messageId);
          this.messages.set(messageId, message);
          return this.endpoint.control!.addReaction!(message, emoji, {
            sceneType: current.sceneType,
            channelId: current.groupId,
          });
        },
        async (messageId, reactionId) => {
          const message = this.messages.get(messageId);
          if (message) await this.endpoint.control!.removeReaction!(message, reactionId);
        },
      );
    }
    if (config.type === 'typing' && this.endpoint.control?.typing) {
      return new NativeTypingIndicator(
        options,
        config,
        async (current) => this.endpoint.control!.typing!(toConversationRef(
          this.endpoint,
          this.platform,
          current,
        ), true),
        async (current) => this.endpoint.control!.typing!(toConversationRef(
          this.endpoint,
          this.platform,
          current,
        ), false),
      );
    }
    if (config.type === 'message' && this.endpoint.control?.recall) {
      return new MessageTypingIndicator(
        options,
        config,
        this.sendMessage,
        async (messageId) => {
          const message = this.messages.get(messageId);
          if (message) await this.endpoint.control!.recall!(message);
        },
        async (messageId, content) => {
          const editBot = this.endpoint as BotWithEditing;
          const message = this.messages.get(messageId);
          if (message && this.endpoint.control?.edit) await this.endpoint.control.edit(message, content);
          else if (typeof editBot.$updateMessage === 'function') await editBot.$updateMessage(messageId, content);
        },
      );
    }
    return new NoneTypingIndicator();
  }
}

function toMessageRef(
  endpoint: Endpoint,
  platform: string,
  options: TypingIndicatorOptions,
  id: string,
): MessageRef {
  return {
    conversation: toConversationRef(endpoint, platform, options),
    id,
  };
}

function toConversationRef(
  endpoint: Endpoint,
  platform: string,
  options: TypingIndicatorOptions,
): ConversationRef {
  const target = resolveSendTarget(options);
  return {
    endpoint: { id: endpoint.$id, adapter: platform },
    kind: options.sceneType,
    id: target.id,
  };
}

export class AdapterActivityFeedbackManager {
  private managers = new Map<string, ActivityFeedbackManager>();

  enableForEndpoint(
    endpoint: EndpointWithActivityFeedback,
    platform: string,
    outbound?: OutboundAdapter,
  ): ActivityFeedbackManager {
    const botKey = JSON.stringify([platform, endpoint.$id]);
    if (this.managers.has(botKey)) {
      return this.managers.get(botKey)!;
    }
    const manager = new ActivityFeedbackManager();
    registerPlatformAdapters(manager, endpoint, platform, outbound);
    this.managers.set(botKey, manager);
    endpoint.$activityFeedback = manager;
    return manager;
  }

  getManager(platform: string, endpointKey: string): ActivityFeedbackManager | undefined {
    return this.managers.get(JSON.stringify([platform, endpointKey]));
  }

  async stopAll(platform: string, endpointKey: string): Promise<void> {
    await this.managers.get(JSON.stringify([platform, endpointKey]))?.stopAll();
  }

  clearAll(): void {
    this.managers.clear();
  }
}

const adapterFeedbackStore = createGenerationStore<AdapterActivityFeedbackManager>('zhin.agent.adapter-activity-feedback');

export function getAdapterActivityFeedbackManager(): AdapterActivityFeedbackManager {
  return adapterFeedbackStore.tryUse() ?? new AdapterActivityFeedbackManager();
}

export function provideAdapterActivityFeedbackManager(context: GenerationStoreContext): AdapterActivityFeedbackManager {
  const manager = new AdapterActivityFeedbackManager();
  adapterFeedbackStore.provide(context, manager);
  context.lifecycle.add(() => manager.clearAll());
  return manager;
}

/** @deprecated 使用 provideAdapterActivityFeedbackManager 替代 */
export const initAdapterActivityFeedbackManager = () => new AdapterActivityFeedbackManager();

export function enableActivityFeedbackForBot(
  endpoint: EndpointWithActivityFeedback,
  platform: string,
  outbound?: OutboundAdapter,
): ActivityFeedbackManager {
  return getAdapterActivityFeedbackManager().enableForEndpoint(endpoint, platform, outbound);
}

export function isGenericActivityFeedbackManager(
  manager: BotActivityFeedbackManager,
): manager is ActivityFeedbackManager {
  return manager instanceof ActivityFeedbackManager;
}
