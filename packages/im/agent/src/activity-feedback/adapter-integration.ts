/**
 * Activity Feedback — endpoint 适配器集成（复用 typing-indicator 底层适配器）
 */

import { getLogger } from '@zhin.js/logger';
import type { Adapter, Endpoint, SendOptions } from '@zhin.js/core';
import type { MessageRef } from '@zhin.js/im-contract';
import { createGenerationStore, type GenerationStoreContext } from '@zhin.js/plugin-runtime';
import {
  ReactionTypingIndicatorAdapter,
  GenericTypingIndicatorAdapter,
  type TypingIndicator,
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
  features: PlatformFeatures,
  outbound?: OutboundAdapter,
): void {
  const messages = new Map<string, MessageRef>();
  const sendMessage = createOutboundSendMessage(endpoint, platform, messages, outbound);
  if (features.supportsReaction && endpoint.control?.addReaction && endpoint.control.removeReaction) {
    manager.registerAdapter(new ReactionTypingIndicatorAdapter(
      platform,
      async (messageId, emoji, options) => {
        try {
          const message = toMessageRef(endpoint, platform, options, messageId);
          messages.set(messageId, message);
          return await endpoint.control!.addReaction!(message, emoji, {
            sceneType: options.sceneType,
            channelId: options.groupId,
          });
        } catch (error) {
          logger.error(`[${platform}] Failed to add reaction:`, error);
          return null;
        }
      },
      async (messageId, reactionId) => {
        try {
          const message = messages.get(messageId);
          if (message) await endpoint.control!.removeReaction!(message, reactionId);
        } catch (error) {
          logger.error(`[${platform}] Failed to remove reaction:`, error);
        }
      },
      sendMessage,
      async (messageId) => {
        const message = messages.get(messageId);
        if (message) await endpoint.control?.recall?.(message);
      },
      async (messageId, content) => {
        const editBot = endpoint as BotWithEditing;
        const message = messages.get(messageId);
        if (message && endpoint.control?.edit) await endpoint.control.edit(message, content);
        else if (typeof editBot.$updateMessage === 'function') await editBot.$updateMessage(messageId, content);
      },
    ));
    return;
  }
  manager.registerAdapter(new GenericTypingIndicatorAdapter(
    platform,
    sendMessage,
    async (messageId) => {
      const message = messages.get(messageId);
      if (message) await endpoint.control?.recall?.(message);
    },
    async (messageId, content) => {
      const editBot = endpoint as BotWithEditing;
      const message = messages.get(messageId);
      if (message && endpoint.control?.edit) await endpoint.control.edit(message, content);
      else if (typeof editBot.$updateMessage === 'function') await editBot.$updateMessage(messageId, content);
    },
  ));
}

function toMessageRef(
  endpoint: Endpoint,
  platform: string,
  options: TypingIndicatorOptions,
  id: string,
): MessageRef {
  const target = resolveSendTarget(options);
  return {
    conversation: {
      endpoint: { id: endpoint.$id, adapter: platform },
      kind: options.sceneType,
      id: target.id,
    },
    id,
  };
}

export class AdapterActivityFeedbackManager {
  private managers = new Map<string, ActivityFeedbackManager>();

  enableForEndpoint(
    endpoint: EndpointWithActivityFeedback,
    platform: string,
    outbound?: OutboundAdapter,
  ): ActivityFeedbackManager {
    const botKey = `${platform}:${endpoint.$id}`;
    if (this.managers.has(botKey)) {
      return this.managers.get(botKey)!;
    }
    const features = PLATFORM_FEATURES[platform] ?? {
      platform,
      supportsReaction: false,
      supportsEdit: false,
      supportsDelete: true,
      supportsTyping: false,
      defaultType: 'message' as const,
    };
    const manager = new ActivityFeedbackManager();
    registerPlatformAdapters(manager, endpoint, platform, features, outbound);
    this.managers.set(botKey, manager);
    endpoint.$activityFeedback = manager;
    return manager;
  }

  getManager(platform: string, endpointKey: string): ActivityFeedbackManager | undefined {
    return this.managers.get(`${platform}:${endpointKey}`);
  }

  async stopAll(platform: string, endpointKey: string): Promise<void> {
    await this.managers.get(`${platform}:${endpointKey}`)?.stopAll();
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
