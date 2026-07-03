/**
 * Dangerous-tool-policy PreToolUse hook — wraps role-based dangerous tool checks.
 */
import type { PreToolUseHook, PreToolUseEvent, ToolHookDecision } from '../orchestrator/types.js';
import {
  checkDangerousToolAccess,
  checkFileToolAccess,
  checkSensitiveFilePathAccess,
  type FileToolName,
} from './dangerous-tool-policy.js';

const DANGEROUS_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'web_fetch']);
const FILE_TOOLS_WITH_PATH = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep']);

function extractFilePath(toolInput: Record<string, unknown>): string | undefined {
  const candidates = ['path', 'filePath', 'file_path', 'file'];
  for (const key of candidates) {
    if (typeof toolInput[key] === 'string') return toolInput[key] as string;
  }
  return undefined;
}

export function createDangerousToolPolicyHook(): PreToolUseHook {
  return {
    name: 'security:dangerous-tool-policy',
    type: 'preToolUse',
    priority: 800,
    handler: (event: PreToolUseEvent): ToolHookDecision => {
      if (DANGEROUS_WRITE_TOOLS.has(event.toolName)) {
        const decision = checkDangerousToolAccess(
          event.toolName as 'write_file' | 'edit_file' | 'web_fetch',
          event.commMessage,
        );
        if (!decision.allowed) {
          return { decision: 'deny', reason: decision.reason ?? 'access denied' };
        }
      }

      if (FILE_TOOLS_WITH_PATH.has(event.toolName)) {
        const roleCheck = checkFileToolAccess(event.toolName as FileToolName, event.commMessage);
        if (!roleCheck.allowed) {
          return { decision: 'deny', reason: roleCheck.reason ?? 'file tool access denied' };
        }

        const filePath = extractFilePath(event.toolInput);
        if (filePath) {
          const pathCheck = checkSensitiveFilePathAccess(
            event.toolName as FileToolName,
            filePath,
            event.commMessage,
          );
          if (!pathCheck.allowed) {
            return { decision: 'deny', reason: pathCheck.reason ?? 'sensitive path access denied' };
          }
        }
      }

      return { decision: 'skip' };
    },
  };
}
