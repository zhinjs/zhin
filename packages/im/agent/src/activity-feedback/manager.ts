import {
  TypingIndicatorManager,
  type TypingIndicator,
  type TypingIndicatorConfig,
  type TypingIndicatorOptions,
} from '../typing-indicator/index.js';
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

let globalManager: ActivityFeedbackManager | null = null;

export function getActivityFeedbackManager(): ActivityFeedbackManager {
  if (!globalManager) {
    globalManager = new ActivityFeedbackManager();
  }
  return globalManager;
}

export function initActivityFeedbackManager(): ActivityFeedbackManager {
  globalManager = new ActivityFeedbackManager();
  return globalManager;
}
