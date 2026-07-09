import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeferredToolSessionSnapshot } from '@zhin.js/ai';
import type { ScheduleJobCreator, ScheduleJobExecutionPlan } from '../assistant/types.js';
import { TurnTracker } from './turn-tracker.js';

export interface ScheduleTurnContext {
  executionPlan?: ScheduleJobExecutionPlan;
  jobId?: string;
  preview?: boolean;
  activityFeedback?: boolean;
  createdBy?: ScheduleJobCreator;
}

export interface TurnContextStore {
  turnId: string;
  tracker: TurnTracker;
  turnActiveSkills: string;
  deferredSnapshotBefore?: DeferredToolSessionSnapshot;
  scheduleContext?: ScheduleTurnContext;
  /** 仅人类 register-ai-trigger 入站为 true；TaskExecutor/subagent/deferred 为 false */
  activityFeedbackEligible?: boolean;
}

const turnContextStorage = new AsyncLocalStorage<TurnContextStore>();

export function runInTurnContext<T>(
  turnId: string,
  tracker: TurnTracker,
  fn: () => Promise<T>,
  init?: Partial<Pick<TurnContextStore, 'scheduleContext' | 'activityFeedbackEligible'>>,
): Promise<T> {
  return turnContextStorage.run({
    turnId,
    tracker,
    turnActiveSkills: '',
    scheduleContext: init?.scheduleContext,
    activityFeedbackEligible: init?.activityFeedbackEligible,
  }, fn);
}

export function getActiveTurnContext(): TurnContextStore | undefined {
  return turnContextStorage.getStore();
}

export function getActiveTurnTracker(): TurnTracker | undefined {
  return turnContextStorage.getStore()?.tracker;
}

export function getTurnActiveSkillsFromContext(): string {
  return turnContextStorage.getStore()?.turnActiveSkills ?? '';
}

export function setTurnActiveSkills(content: string): void {
  const store = turnContextStorage.getStore();
  if (store) store.turnActiveSkills = content;
}

export function appendTurnActiveSkills(fragment: string): void {
  const store = turnContextStorage.getStore();
  if (!store) return;
  const trimmed = fragment.trim();
  if (!trimmed) return;
  store.turnActiveSkills = store.turnActiveSkills
    ? `${store.turnActiveSkills}\n\n${trimmed}`
    : trimmed;
}

export function getScheduleTurnContext(): ScheduleTurnContext | undefined {
  return turnContextStorage.getStore()?.scheduleContext;
}

export function getActivityFeedbackEligible(): boolean {
  return turnContextStorage.getStore()?.activityFeedbackEligible === true;
}

export function setScheduleTurnContext(ctx: ScheduleTurnContext | undefined): void {
  const store = turnContextStorage.getStore();
  if (store) store.scheduleContext = ctx;
}

export function cloneDeferredSnapshot(snapshot: DeferredToolSessionSnapshot): DeferredToolSessionSnapshot {
  return {
    loadedTools: { ...snapshot.loadedTools },
    loadedSkills: [...snapshot.loadedSkills],
  };
}

export function captureDeferredSnapshotBefore(snapshot: DeferredToolSessionSnapshot): void {
  const store = turnContextStorage.getStore();
  if (!store) return;
  store.deferredSnapshotBefore = cloneDeferredSnapshot(snapshot);
}

export function getDeferredSnapshotBefore(): DeferredToolSessionSnapshot | undefined {
  const raw = turnContextStorage.getStore()?.deferredSnapshotBefore;
  return raw ? cloneDeferredSnapshot(raw) : undefined;
}
