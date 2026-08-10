import {
  TypingIndicatorManager,
  type TypingIndicator,
  type TypingIndicatorConfig,
  type TypingIndicatorOptions,
} from '../typing-indicator/index.js';
import { createGenerationStore, type GenerationStoreContext } from '@zhin.js/plugin-runtime';
import { type ActivityFeedbackPhase, toTypingIndicatorConfig, type ResolvedActivityFeedbackPhaseConfig } from './types.js';
function phaseSessionId(sessionId: string, phase: ActivityFeedbackPhase): string {
  return `${sessionId}::phase:${phase}`;
}

function withPhase(
  options: TypingIndicatorOptions,
  phase: ActivityFeedbackPhase,
): TypingIndicatorOptions {
  return {
    ...options,
    sessionId: phaseSessionId(options.sessionId ?? options.messageId ?? '', phase),
  };
}

export class ActivityFeedbackManager {
  private readonly inner = new TypingIndicatorManager();

  registerAdapter(...args: Parameters<TypingIndicatorManager['registerAdapter']>): void {
    this.inner.registerAdapter(...args);
  }

  getAdapter(platform: string) {
    return this.inner.getAdapter(platform);
  }

  async start(
    phase: ActivityFeedbackPhase,
    options: TypingIndicatorOptions,
    config: ResolvedActivityFeedbackPhaseConfig,
  ): Promise<TypingIndicator> {
    return this.inner.start(withPhase(options, phase), toTypingIndicatorConfig(config));
  }

  async stop(phase: ActivityFeedbackPhase, options: TypingIndicatorOptions): Promise<void> {
    return this.inner.stop(withPhase(options, phase));
  }

  getActiveIndicator(
    phase: ActivityFeedbackPhase,
    options: TypingIndicatorOptions,
  ): TypingIndicator | undefined {
    return this.inner.getActiveIndicator(withPhase(options, phase));
  }

  async stopAll(): Promise<void> {
    return this.inner.stopAll();
  }

  async dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

const feedbackStore = createGenerationStore<ActivityFeedbackManager>('zhin.agent.activity-feedback');

export function getActivityFeedbackManager(): ActivityFeedbackManager {
  return feedbackStore.tryUse() ?? new ActivityFeedbackManager();
}

export function provideActivityFeedbackManager(context: GenerationStoreContext): ActivityFeedbackManager {
  const manager = new ActivityFeedbackManager();
  feedbackStore.provide(context, manager);
  context.lifecycle.add(() => manager.dispose());
  return manager;
}

/** @deprecated 使用 provideActivityFeedbackManager 替代 */
export const initActivityFeedbackManager = () => new ActivityFeedbackManager();
