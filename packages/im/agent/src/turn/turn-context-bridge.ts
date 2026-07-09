import { type ScheduleTurnContext, appendTurnActiveSkills, getTurnActiveSkillsFromContext, runInTurnContext as runInTurnContextAls } from '../internal/turn-context.js';
import { TurnTracker } from './turn-tracker.js';
import type { ZhinAgentConfig } from '../config/index.js';
export interface TurnContextBridgeState {
  pendingScheduleTurnContext?: ScheduleTurnContext;
  pendingActivityFeedbackEligible?: boolean;
  alwaysSkillsBaseline: string;
}

export function initScheduleTurnContext(state: TurnContextBridgeState, ctx: ScheduleTurnContext): void {
  state.pendingScheduleTurnContext = ctx;
  state.pendingActivityFeedbackEligible = false;
}

export function initInboundTurnContext(state: TurnContextBridgeState): void {
  state.pendingActivityFeedbackEligible = true;
  state.pendingScheduleTurnContext = undefined;
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
): Promise<T> {
  const tracker = new TurnTracker(config.subagentTurnWaitMs);
  const scheduleContext = state.pendingScheduleTurnContext;
  const activityFeedbackEligible = state.pendingActivityFeedbackEligible;
  state.pendingScheduleTurnContext = undefined;
  state.pendingActivityFeedbackEligible = undefined;
  const init: Partial<Pick<import('../internal/turn-context.js').TurnContextStore, 'scheduleContext' | 'activityFeedbackEligible'>> = {};
  if (scheduleContext) init.scheduleContext = scheduleContext;
  if (activityFeedbackEligible) init.activityFeedbackEligible = true;
  return runInTurnContextAls(turnId, tracker, fn, Object.keys(init).length ? init : undefined);
}

export function appendActiveSkills(fragment: string): void {
  appendTurnActiveSkills(fragment);
}
