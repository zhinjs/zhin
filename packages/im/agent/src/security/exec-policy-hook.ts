/**
 * Exec-policy PreToolUse hook — wraps checkExecPolicy for the unified hook chain.
 */
import type { PreToolUseHook, PreToolUseEvent, ToolHookDecision } from '../orchestrator/types.js';
import type { ZhinAgentConfig } from '../config/index.js';
import { checkExecPolicyWithOptions } from './exec-policy.js';

export function createExecPolicyHook(config: Required<ZhinAgentConfig>): PreToolUseHook {
  return {
    name: 'security:exec-policy',
    type: 'preToolUse',
    priority: 1000,
    handler: (event: PreToolUseEvent): ToolHookDecision => {
      if (event.toolName !== 'bash') return { decision: 'skip' };

      const command = event.toolInput.command != null ? String(event.toolInput.command) : '';
      const result = checkExecPolicyWithOptions(config, command);

      if (!result.allowed) {
        if (result.needsApproval) {
          return {
            decision: 'modify',
            modifiedInput: {
              ...event.toolInput,
              __needsApproval: true,
              __approvalReason: result.reason,
            },
          };
        }
        return { decision: 'deny', reason: result.reason ?? 'exec policy denied' };
      }

      return { decision: 'allow' };
    },
  };
}
