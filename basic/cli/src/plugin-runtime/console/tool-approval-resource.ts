import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import type { ToolApprovalQueue } from '@zhin.js/agent/security';

/** The existing queue belongs to the exact Agent Root, never a process-level current pointer. */
export const agentToolApprovalQueueToken = createRootPrivateToken<ToolApprovalQueue>('zhin.host.agent.tool-approval-queue');
