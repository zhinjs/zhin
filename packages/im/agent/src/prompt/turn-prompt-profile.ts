import type { ScheduleJobCreator } from '../assistant/types.js';
import type { HostScheduleSecurityContext } from '../internal/host-types.js';

export type AgentPromptProfile =
  | Readonly<{ kind: 'interactive' }>
  | Readonly<{
      kind: 'schedule';
      jobId: string;
      prompt: string;
      createdBy?: ScheduleJobCreator;
      security: Readonly<{
        execPreset: HostScheduleSecurityContext['execPreset'];
        rejectOwnerApproval: true;
        allowedDomains: readonly string[];
      }>;
    }>;
