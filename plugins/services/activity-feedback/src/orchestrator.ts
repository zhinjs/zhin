import {
  toActivityFeedbackEventContext,
  isActivityFeedbackEnabled,
  applySubagentActivityPrefixToConfig,
  withSubagentActivityPrefix,
  type AIEventPayload,
  type ActivityFeedbackPhase,
} from '@zhin.js/agent';
import { ActivityFeedbackExecutor } from './executor.js';
import { ActivityFeedbackPolicy } from './policy.js';

type Logger = { debug: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void };

export class ActivityFeedbackOrchestrator {
  private readonly active = new Map<string, {
    ctx: NonNullable<ReturnType<typeof toActivityFeedbackEventContext>>;
    phase: ActivityFeedbackPhase;
  }>();
  private readonly transient = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    ctx: NonNullable<ReturnType<typeof toActivityFeedbackEventContext>>;
    phase: ActivityFeedbackPhase;
  }>();

  constructor(
    private readonly policy: ActivityFeedbackPolicy,
    private readonly executor: ActivityFeedbackExecutor,
    private readonly log: Logger,
  ) {}

  async startPhase(payload: AIEventPayload, phase: ActivityFeedbackPhase, reason: string): Promise<void> {
    const gatePhase = phase as import('@zhin.js/agent').ActivityFeedbackGatePhase;
    if (!isActivityFeedbackEnabled(payload, gatePhase)) {
      this.log.debug(
        `[ActivityFeedback] skip ${phase} (${reason}): gate closed`
        + ` (eligible=${String(payload.hookContext?.activityFeedbackEligible)})`,
      );
      return;
    }
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx) {
      this.log.debug(
        `[ActivityFeedback] skip ${phase} (${reason}): unresolvable context`
        + ` (platform=${String(payload.platform)} endpoint=${String(payload.endpointKey)})`,
      );
      return;
    }

    try {
      const resolution = this.policy.resolvePhase(ctx.platform, ctx.endpointKey, phase, ctx.sceneType);
      if (resolution.kind !== 'active') {
        this.log.debug(
          `[ActivityFeedback] skip ${phase} (${reason}): policy=${resolution.kind}`
          + ` (${ctx.platform}:${ctx.endpointKey} ${ctx.sceneType})`,
        );
        return;
      }

      const config = applySubagentActivityPrefixToConfig(resolution.config, payload);
      this.log.debug(`[ActivityFeedback] start ${phase} (${reason}) session=${ctx.sessionId}`);
      await this.executor.start(ctx, phase, config);
      this.active.set(this.phaseKey(ctx, phase), { ctx, phase });
    } catch (error) {
      this.log.error(`[ActivityFeedback] start ${phase} failed (${reason}):`, error);
    }
  }

  async stopPhase(payload: AIEventPayload, phase: ActivityFeedbackPhase, reason: string): Promise<void> {
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx) return;
    const key = this.phaseKey(ctx, phase);
    this.clearTransient(key);
    this.active.delete(key);

    try {
      this.log.debug(`[ActivityFeedback] stop ${phase} (${reason}) session=${ctx.sessionId}`);
      await this.executor.stop(ctx, phase);
    } catch (error) {
      this.log.error(`[ActivityFeedback] stop ${phase} failed (${reason}):`, error);
    }
  }

  async updateThinkingText(payload: AIEventPayload, text: string): Promise<void> {
    await this.updatePhaseText(payload, 'thinking', text);
  }

  async updatePhaseText(
    payload: AIEventPayload,
    phase: ActivityFeedbackPhase,
    text: string,
  ): Promise<void> {
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx || !text) return;

    try {
      await this.executor.updateText(ctx, phase, withSubagentActivityPrefix(text, payload));
    } catch (error) {
      this.log.error(`[ActivityFeedback] ${phase} update failed:`, error);
    }
  }

  async showTransientPhase(
    payload: AIEventPayload,
    phase: ActivityFeedbackPhase,
    reason: string,
  ): Promise<void> {
    await this.startPhase(payload, phase, reason);
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx) return;
    const resolution = this.policy.resolvePhase(ctx.platform, ctx.endpointKey, phase, ctx.sceneType);
    if (resolution.kind !== 'active') return;
    const delay = resolution.config.removeDelay ?? 3_000;
    const key = this.phaseKey(ctx, phase);
    this.clearTransient(key);
    const timer = setTimeout(() => {
      this.transient.delete(key);
      this.active.delete(key);
      void this.executor.stop(ctx, phase).catch((error) => {
        this.log.error(`[ActivityFeedback] transient ${phase} cleanup failed:`, error);
      });
    }, Math.max(0, delay));
    timer.unref?.();
    this.transient.set(key, { timer, ctx, phase });
  }

  async dispose(): Promise<void> {
    const pending = [...this.active.values()];
    const timers = [...this.transient.values()];
    this.active.clear();
    this.transient.clear();
    for (const item of timers) clearTimeout(item.timer);
    await Promise.allSettled(pending.map((item) => this.executor.stop(item.ctx, item.phase)));
  }

  private phaseKey(
    ctx: NonNullable<ReturnType<typeof toActivityFeedbackEventContext>>,
    phase: ActivityFeedbackPhase,
  ): string {
    return JSON.stringify([ctx.platform, ctx.endpointKey, ctx.sessionId, phase]);
  }

  private clearTransient(key: string): void {
    const current = this.transient.get(key);
    if (!current) return;
    clearTimeout(current.timer);
    this.transient.delete(key);
  }
}
