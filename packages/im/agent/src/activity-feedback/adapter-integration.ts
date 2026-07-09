/**
 * Activity Feedback — endpoint 适配器集成（复用 typing-indicator 底层适配器）
 */

import type { Adapter, Endpoint, SendOptions } from '@zhin.js/core';
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

export { PLATFORM_FEATURES, buildTypingSendContent, type PlatformFeatures };

type OutboundAdapter = Pick<Adapter, 'sendMessage'>;

function resolveSendTarget(options: TypingIndicatorOptions): { type: 'private' | 'group'; id: string } {
  if ((options.sceneType === 'group' || options.sceneType === 'channel') && options.groupId) {
    return { type: 'group', id: options.groupId };
  }
  if (options.userId) {
    return { type: 'private', id: options.userId };
  }
  const parts = (options.sessionId ?? '').split(':').filter((p) => p.length > 0);
  if (parts.length >= 3) return { type: 'group', id: parts[1]! };
  if (parts.length >= 2) return { type: 'private', id: parts[parts.length - 1]! };
  return { type: 'private', id: options.sessionId ?? '' };
}

function createOutboundSendMessage(
  endpoint: Endpoint,
  platform: string,
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
      if (outbound) return await outbound.sendMessage(sendOptions);
      console.error(`[${platform}] Activity feedback requires Adapter.sendMessage; endpoint ${endpoint.$id} has no outbound adapter`);
      return null;
    } catch (error) {
      console.error(`[${platform}] Failed to send activity feedback message:`, error);
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
  $addReaction?(
    messageId: string,
    emoji: string,
    hint?: { sceneType?: 'private' | 'group' | 'channel' },
  ): Promise<string | null>;
  $removeReaction?(messageId: string, reactionId: string): Promise<void>;
}

function registerPlatformAdapters(
  manager: ActivityFeedbackManager,
  endpoint: EndpointWithActivityFeedback,
  platform: string,
  features: PlatformFeatures,
  outbound?: OutboundAdapter,
): void {
  const sendMessage = createOutboundSendMessage(endpoint, platform, outbound);
  if (features.supportsReaction && endpoint.$addReaction && endpoint.$removeReaction) {
    manager.registerAdapter(new ReactionTypingIndicatorAdapter(
      platform,
      async (messageId, emoji, options) => {
        try {
          return await endpoint.$addReaction!(messageId, emoji, { sceneType: options.sceneType });
        } catch (error) {
          console.error(`[${platform}] Failed to add reaction:`, error);
          return null;
        }
      },
      async (messageId, reactionId) => {
        try {
          await endpoint.$removeReaction!(messageId, reactionId);
        } catch (error) {
          console.error(`[${platform}] Failed to remove reaction:`, error);
        }
      },
      sendMessage,
      async (messageId) => { await endpoint.$recallMessage(messageId); },
      async (messageId, content) => {
        const editBot = endpoint as BotWithEditing;
        if (typeof editBot.$editMessage === 'function') await editBot.$editMessage(messageId, content);
        else if (typeof editBot.$updateMessage === 'function') await editBot.$updateMessage(messageId, content);
      },
    ));
    return;
  }
  manager.registerAdapter(new GenericTypingIndicatorAdapter(
    platform,
    sendMessage,
    async (messageId) => { await endpoint.$recallMessage(messageId); },
    async (messageId, content) => {
      const editBot = endpoint as BotWithEditing;
      if (typeof editBot.$editMessage === 'function') await editBot.$editMessage(messageId, content);
      else if (typeof editBot.$updateMessage === 'function') await editBot.$updateMessage(messageId, content);
    },
  ));
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

  getManager(platform: string, endpointId: string): ActivityFeedbackManager | undefined {
    return this.managers.get(`${platform}:${endpointId}`);
  }

  async stopAll(platform: string, endpointId: string): Promise<void> {
    await this.managers.get(`${platform}:${endpointId}`)?.stopAll();
  }

  clearAll(): void {
    this.managers.clear();
  }
}

let globalAdapterManager: AdapterActivityFeedbackManager | null = null;

export function getAdapterActivityFeedbackManager(): AdapterActivityFeedbackManager {
  if (!globalAdapterManager) {
    globalAdapterManager = new AdapterActivityFeedbackManager();
  }
  return globalAdapterManager;
}

export function initAdapterActivityFeedbackManager(): AdapterActivityFeedbackManager {
  globalAdapterManager = new AdapterActivityFeedbackManager();
  return globalAdapterManager;
}

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
