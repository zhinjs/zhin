import type { AssistantEventResult } from './event-types.js';
import type { JobNotify, ScheduleJob } from './types.js';
import type { UnschedulableJob } from './timer-scheduler.js';

export type AssistantScheduleJobInput = Omit<
  ScheduleJob,
  'createdAt' | 'updatedAt' | 'state'
> & {
  createdAt?: number;
  updatedAt?: number;
  state?: ScheduleJob['state'];
};

/** Generation-owned Assistant projection exposed through AgentHostPort. */
export interface AssistantRuntimeHandle {
  readonly events: {
    isEnabled(): boolean;
    handle(body: unknown): Promise<AssistantEventResult>;
  };
  readonly jobs: {
    list(): Promise<ScheduleJob[]>;
    add(job: AssistantScheduleJobInput): Promise<ScheduleJob>;
    remove(id: string): Promise<boolean>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
    /** Enabled jobs whose next run cannot be computed (#1250). */
    unschedulable?(): readonly UnschedulableJob[];
    /**
     * The IM delivery target a job without its own target falls back to: `assistant.defaults.notify`,
     * else the profile's `defaults.notify` (#1250).
     */
    defaultImNotify?(): Extract<JobNotify, { channel: 'im' }> | undefined;
  };
}
