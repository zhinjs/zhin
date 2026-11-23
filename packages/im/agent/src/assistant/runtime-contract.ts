import type { AssistantEventResult } from './event-types.js';
import type { JobNotify, ScheduleJob, ScheduleJobUpdate } from './types.js';
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
    /**
     * Agents a job may run on (`action.agent`, #1250 b52): the configured bindings (`zhin` and
     * `ai.agents`). Callers reject any other name.
     */
    agents?(): readonly string[];
    /**
     * Sets or clears (`undefined`) a job's Agent (#1250 b52); `null` = no such job. Throws for a
     * heartbeat job. Callers validate the name against {@link agents} first.
     */
    setAgent?(id: string, agent: string | undefined): Promise<ScheduleJob | null>;
    /**
     * Changes a job's schedule, label or enabled state in place (#1250 b90), keeping everything
     * else; `null` = no such job. Callers refuse profile routines and check delivery permission.
     */
    update?(id: string, update: ScheduleJobUpdate): Promise<ScheduleJob | null>;
  };
}
