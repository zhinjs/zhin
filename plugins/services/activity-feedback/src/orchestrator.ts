import {
  toActivityFeedbackEventContext,
  isActivityFeedbackEnabled,
  type AIEventPayload,
  type ActivityFeedbackPhase,
} from '@zhin.js/agent';
import { ActivityFeedbackExecutor } from './executor.js';
import { ActivityFeedbackPolicy } from './policy.js';

type Logger = { debug: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void };

export class ActivityFeedbackOrchestrator {
  constructor(
    private readonly policy: ActivityFeedbackPolicy,
    private readonly executor: ActivityFeedbackExecutor,
    private readonly log: Logger,
  ) {}

  async startPhase(payload: AIEventPayload, phase: ActivityFeedbackPhase, reason: string): Promise<void> {
    const gatePhase = phase as import('@zhin.js/agent').ActivityFeedbackGatePhase;
    if (!isActivityFeedbackEnabled(payload, gatePhase)) return;
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx) return;

    try {
      const resolution = this.policy.resolvePhase(ctx.platform, ctx.endpointId, phase, ctx.sceneType);
      if (resolution.kind !== 'active') return;

      this.log.debug(`[ActivityFeedback] start ${phase} (${reason}) session=${ctx.sessionId}`);
      await this.executor.start(ctx, phase, resolution.config);
    } catch (error) {
      this.log.error(`[ActivityFeedback] start ${phase} failed (${reason}):`, error);
    }
  }

  async stopPhase(payload: AIEventPayload, phase: ActivityFeedbackPhase, reason: string): Promise<void> {
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx) return;

    try {
      this.log.debug(`[ActivityFeedback] stop ${phase} (${reason}) session=${ctx.sessionId}`);
      await this.executor.stop(ctx, phase);
    } catch (error) {
      this.log.error(`[ActivityFeedback] stop ${phase} failed (${reason}):`, error);
    }
  }

  async updateThinkingText(payload: AIEventPayload, text: string): Promise<void> {
    const ctx = toActivityFeedbackEventContext(payload);
    if (!ctx || !text) return;

    try {
      await this.executor.updateThinkingText(ctx, text);
    } catch (error) {
      this.log.error('[ActivityFeedback] thinking update failed:', error);
    }
  }
}
