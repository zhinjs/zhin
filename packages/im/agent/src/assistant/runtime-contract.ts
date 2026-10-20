import type { AssistantEventResult } from './event-types.js';
import type { ScheduleJob } from './types.js';

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
  };
}
