import type { Adapter } from 'zhin.js';
import {
  enableActivityFeedbackForBot,
  isGenericActivityFeedbackManager,
  type ActivityFeedbackManager,
  type ActivityFeedbackPhase,
  type EndpointWithActivityFeedback,
  type PlatformActivityFeedbackManager,
  type ResolvedActivityFeedbackPhaseConfig,
} from '@zhin.js/agent';
import type { ActivityFeedbackEventContext } from '@zhin.js/agent';

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
