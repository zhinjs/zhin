import { type ScheduleTurnContext, appendTurnActiveSkills, getTurnActiveSkillsFromContext, runInTurnContext as runInTurnContextAls } from '../internal/turn-context.js';
import { TurnTracker } from './turn-tracker.js';
import type { ZhinAgentConfig } from '../config/index.js';
export interface TurnContextBridgeState {
  pendingActivityFeedbackEligible?: boolean;
  alwaysSkillsBaseline: string;
}

/** Explicit turn state used by concurrency-safe entry points. */
export interface TurnContextRunOptions {
  readonly scheduleContext?: ScheduleTurnContext;
  readonly activityFeedbackEligible?: boolean;
}

export function initInboundTurnContext(state: TurnContextBridgeState): void {
  state.pendingActivityFeedbackEligible = true;
}

export function getTurnActiveSkills(state: TurnContextBridgeState): string {
  const fromTurn = getTurnActiveSkillsFromContext();
  if (fromTurn) return fromTurn;
  return state.alwaysSkillsBaseline;
}

export function runInTurnContext<T>(
  state: TurnContextBridgeState,
  config: Required<ZhinAgentConfig>,
  turnId: string,
  fn: () => Promise<T>,
  options?: TurnContextRunOptions,
): Promise<T> {
  const tracker = new TurnTracker(config.subagentTurnWaitMs);
  const scheduleContext = options?.scheduleContext;
  const activityFeedbackEligible = options?.activityFeedbackEligible
    ?? state.pendingActivityFeedbackEligible;
  if (options?.activityFeedbackEligible === undefined) state.pendingActivityFeedbackEligible = undefined;
  const init: Partial<Pick<import('../internal/turn-context.js').TurnContextStore, 'scheduleContext' | 'activityFeedbackEligible'>> = {};
  if (scheduleContext) init.scheduleContext = scheduleContext;
  if (activityFeedbackEligible) init.activityFeedbackEligible = true;
  return runInTurnContextAls(turnId, tracker, fn, Object.keys(init).length ? init : undefined);
}

export function appendActiveSkills(fragment: string): void {
  appendTurnActiveSkills(fragment);
}
