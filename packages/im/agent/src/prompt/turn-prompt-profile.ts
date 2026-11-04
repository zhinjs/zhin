import type { ScheduleJobCreator } from '../assistant/types.js';

export type AgentPromptProfile =
  | Readonly<{ kind: 'interactive' }>
  /** An explicit internal role; the originating IM account does not define its persona. */
  | Readonly<{ kind: 'delegated'; persona: string }>
  | Readonly<{
      kind: 'schedule';
      jobId: string;
      prompt: string;
      createdBy?: ScheduleJobCreator;
      security: Readonly<{
        execPreset: 'readonly' | 'network';
        rejectOwnerApproval: true;
        allowedDomains: readonly string[];
      }>;
    }>;
