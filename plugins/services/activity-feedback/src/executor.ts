import type { Adapter } from 'zhin.js';
import { enableActivityFeedbackForBot, isGenericActivityFeedbackManager, type ActivityFeedbackManager, type ActivityFeedbackPhase, type EndpointWithActivityFeedback, type PlatformActivityFeedbackManager, type ResolvedActivityFeedbackPhaseConfig, type ActivityFeedbackEventContext } from '@zhin.js/agent';
import type { OutboundHost } from '@zhin.js/plugin-runtime';

/** IM 侧 endpoint 访问 seam（便于测试注入 fake） */
export interface ActivityFeedbackEndpointAccess {
  resolve(
    platform: string,
    endpointId: string,
  ): { endpoint: EndpointWithActivityFeedback; adapter: Adapter } | undefined;
}

export function createRootEndpointAccess(root: {
  injectAdapter(platform: string): Adapter | undefined;
}): ActivityFeedbackEndpointAccess {
  return {
    resolve(platform, endpointId) {
      const adapter = root.injectAdapter(platform);
      const endpoint = adapter?.endpoints?.get(endpointId) as EndpointWithActivityFeedback | undefined;
      if (!endpoint || !adapter) return undefined;
      return { endpoint, adapter };
    },
  };
}

/** Slice-2: no Adapter inject — executor start/stop no-op when resolve returns undefined. */
export function createNoopEndpointAccess(): ActivityFeedbackEndpointAccess {
  return {
    resolve() {
      return undefined;
    },
  };
}

function stringifySendContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.map((segment) => {
    if (typeof segment === 'string') return segment;
    if (segment && typeof segment === 'object') {
      const data = (segment as { data?: { text?: string }; text?: string }).data
        ?? (segment as { text?: string });
      if (typeof data === 'object' && data && 'text' in data && typeof data.text === 'string') {
        return data.text;
      }
      if (typeof (segment as { text?: string }).text === 'string') {
        return (segment as { text: string }).text;
      }
    }
    return '';
  }).join('');
}

/**
 * Plugin Runtime: resolve endpoints via OutboundHost → ImRuntime.sendEndpointMessage.
 * Typing/reaction text goes through the unified outbound chain (no legacy Adapter.inject).
 *
 * 按 platform:endpointId 缓存 { endpoint, adapter }：activity manager 挂在
 * endpoint.$activityFeedback 上，start/stop 必须解析到同一个对象，否则
 * stop 时拿不到 manager，typing 指示器永远无法停止。
 */
export function createOutboundEndpointAccess(
  outbound: OutboundHost,
  logger?: { debug: (msg: string, ...args: unknown[]) => void },
): ActivityFeedbackEndpointAccess {
  const cache = new Map<string, { endpoint: EndpointWithActivityFeedback; adapter: Adapter }>();
  return {
    resolve(platform, endpointId) {
      const key = `${platform}:${endpointId}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const addReaction = outbound.addReaction;
      const removeReaction = outbound.removeReaction;
      const endpoint = {
        $id: endpointId,
        // Prefer real OutboundHost.recall when available (icqq RECALL_MSG).
        $recallMessage: async (messageId: string) => {
          if (outbound.recall) {
            try {
              await outbound.recall({ adapter: platform, endpointId, messageId });
              return;
            } catch (error) {
              logger?.debug(
                `[ActivityFeedback] outbound recall failed (${key}):`,
                error instanceof Error ? error.message : String(error),
              );
              return;
            }
          }
          logger?.debug(
            `[ActivityFeedback] recall not supported via OutboundHost (${key}, messageId=${messageId})`,
          );
        },
        $addReaction: addReaction
          ? async (
            messageId: string,
            emoji: string,
            hint?: { sceneType?: 'private' | 'group' | 'channel'; channelId?: string },
          ) => addReaction({
            adapter: platform,
            endpointId,
            messageId,
            emoji,
            sceneType: hint?.sceneType,
            channelId: hint?.channelId,
          })
          : undefined,
        $removeReaction: removeReaction
          ? async (messageId: string, reactionId: string) => {
            await removeReaction({
              adapter: platform,
              endpointId,
              messageId,
              reactionId,
            });
          }
          : undefined,
      } as EndpointWithActivityFeedback;
      const adapter = {
        sendMessage: async (options: {
          type?: string;
          id?: string;
          content?: unknown;
        }) => {
          const text = stringifySendContent(options.content);
          if (!text || !options.id) return null;
          try {
            const messageId = await outbound.send({
              adapter: platform,
              endpointId,
              channelType: options.type || 'private',
              channelId: options.id,
              content: text,
            });
            // Prefer real id; fall back to a sentinel so MessageTypingIndicator
            // keeps the phase active until stop (recall is a no-op here).
            return messageId || `outbound:${Date.now()}`;
          } catch (error) {
            logger?.debug(
              `[ActivityFeedback] outbound send failed (${key}):`,
              error instanceof Error ? error.message : String(error),
            );
            return null;
          }
        },
        endpoints: {
          get: (id: string) => (id === endpointId ? endpoint : undefined),
        },
      };
      const resolved = { endpoint, adapter: adapter as unknown as Adapter };
      cache.set(key, resolved);
      return resolved;
    },
  };
}

interface PhaseDriver {
  start(
    ctx: ActivityFeedbackEventContext,
    phase: ActivityFeedbackPhase,
    phaseConfig: ResolvedActivityFeedbackPhaseConfig,
  ): Promise<void>;
  stop(ctx: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase): Promise<void>;
  updateThinkingText(ctx: ActivityFeedbackEventContext, text: string): Promise<void>;
}

class PlatformPhaseDriver implements PhaseDriver {
  constructor(private readonly manager: PlatformActivityFeedbackManager) {}

  async start(
    ctx: ActivityFeedbackEventContext,
    phase: ActivityFeedbackPhase,
    phaseConfig: ResolvedActivityFeedbackPhaseConfig,
  ): Promise<void> {
    const sceneType = ctx.sceneType === 'channel' ? 'group' : ctx.sceneType;
    await this.manager.start({
      messageId: ctx.messageId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      groupId: ctx.groupId,
      sceneType,
      phase,
      phaseConfig,
    });
  }

  async stop(ctx: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase): Promise<void> {
    await this.manager.stop({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      groupId: ctx.groupId,
      phase,
    });
  }

  async updateThinkingText(ctx: ActivityFeedbackEventContext, text: string): Promise<void> {
    const indicator = this.manager.getActiveIndicator?.('thinking', ctx.options);
    if (indicator?.update) {
      await indicator.update(text);
    }
  }
}

class GenericPhaseDriver implements PhaseDriver {
  private manager?: ActivityFeedbackManager;

  constructor(
    private readonly endpoint: EndpointWithActivityFeedback,
    private readonly platform: string,
    private readonly adapter: Adapter,
  ) {}

  private async ensureManager(): Promise<ActivityFeedbackManager> {
    if (this.manager) return this.manager;
    const existing = this.endpoint.$activityFeedback;
    if (existing && isGenericActivityFeedbackManager(existing)) {
      this.manager = existing;
      return existing;
    }
    this.manager = enableActivityFeedbackForBot(this.endpoint, this.platform, this.adapter);
    return this.manager;
  }

  async start(
    ctx: ActivityFeedbackEventContext,
    phase: ActivityFeedbackPhase,
    phaseConfig: ResolvedActivityFeedbackPhaseConfig,
  ): Promise<void> {
    const manager = await this.ensureManager();
    if (manager.getActiveIndicator(phase, ctx.options)) return;
    await manager.start(phase, ctx.options, phaseConfig);
  }

  async stop(ctx: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase): Promise<void> {
    const manager = this.endpoint.$activityFeedback;
    if (!manager || !isGenericActivityFeedbackManager(manager)) return;
    await manager.stop(phase, ctx.options);
  }

  async updateThinkingText(ctx: ActivityFeedbackEventContext, text: string): Promise<void> {
    const manager = this.endpoint.$activityFeedback;
    if (!manager || !isGenericActivityFeedbackManager(manager)) return;
    const indicator = manager.getActiveIndicator('thinking', ctx.options);
    if (indicator?.update) {
      await indicator.update(text);
    }
  }
}

function createPhaseDriver(
  endpoint: EndpointWithActivityFeedback,
  platform: string,
  adapter: Adapter,
): PhaseDriver {
  const manager = endpoint.$activityFeedback;
  if (manager && !isGenericActivityFeedbackManager(manager)) {
    return new PlatformPhaseDriver(manager);
  }
  return new GenericPhaseDriver(endpoint, platform, adapter);
}

export class ActivityFeedbackExecutor {
  constructor(private readonly access: ActivityFeedbackEndpointAccess) {}

  async start(
    ctx: ActivityFeedbackEventContext,
    phase: ActivityFeedbackPhase,
    phaseConfig: ResolvedActivityFeedbackPhaseConfig,
  ): Promise<void> {
    const resolved = this.access.resolve(ctx.platform, ctx.endpointId);
    if (!resolved) return;
    const driver = createPhaseDriver(resolved.endpoint, ctx.platform, resolved.adapter);
    await driver.start(ctx, phase, phaseConfig);
  }

  async stop(ctx: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase): Promise<void> {
    const resolved = this.access.resolve(ctx.platform, ctx.endpointId);
    if (!resolved?.endpoint.$activityFeedback) return;
    const driver = createPhaseDriver(resolved.endpoint, ctx.platform, resolved.adapter);
    await driver.stop(ctx, phase);
  }

  async updateThinkingText(ctx: ActivityFeedbackEventContext, text: string): Promise<void> {
    const resolved = this.access.resolve(ctx.platform, ctx.endpointId);
    if (!resolved) return;
    const driver = createPhaseDriver(resolved.endpoint, ctx.platform, resolved.adapter);
    await driver.updateThinkingText(ctx, text);
  }
}
