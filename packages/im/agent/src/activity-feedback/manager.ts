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

function reactionPhaseSessionId(
  sessionId: string,
  phase: ActivityFeedbackPhase,
  messageId: string,
): string {
  return `${phaseSessionId(sessionId, phase)}::message:${messageId}`;
}

function withPhase(
  options: TypingIndicatorOptions,
  phase: ActivityFeedbackPhase,
  messageScoped = false,
): TypingIndicatorOptions {
  const sessionId = options.sessionId ?? options.messageId ?? '';
  return {
    ...options,
    sessionId: messageScoped && options.messageId
      ? reactionPhaseSessionId(sessionId, phase, options.messageId)
      : phaseSessionId(sessionId, phase),
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
    const typingConfig = toTypingIndicatorConfig(config);
    const adapter = this.inner.getAdapter(options.platform);
    const resolvedType = adapter?.supportedTypes.includes(config.type)
      ? config.type
      : adapter?.supportedTypes[0];
    return this.inner.start(
      withPhase(options, phase, resolvedType === 'reaction'),
      typingConfig,
    );
  }

  async stop(phase: ActivityFeedbackPhase, options: TypingIndicatorOptions): Promise<void> {
    if (options.messageId) {
      await this.inner.stop(withPhase(options, phase, true));
    }
    return this.inner.stop(withPhase(options, phase));
  }

  getActiveIndicator(
    phase: ActivityFeedbackPhase,
    options: TypingIndicatorOptions,
  ): TypingIndicator | undefined {
    return (options.messageId
      ? this.inner.getActiveIndicator(withPhase(options, phase, true))
      : undefined)
      ?? this.inner.getActiveIndicator(withPhase(options, phase));
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
