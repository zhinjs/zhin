import type { ScheduleJobCreator } from '../assistant/types.js';

export type AgentPromptProfile =
  | Readonly<{ kind: 'interactive' }>
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
