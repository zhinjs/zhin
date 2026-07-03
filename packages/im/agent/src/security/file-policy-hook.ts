/**
 * File-policy PreToolUse hook — wraps checkFileAccess for the unified hook chain.
 */
import type { PreToolUseHook, PreToolUseEvent, ToolHookDecision } from '../orchestrator/types.js';
import { checkFileAccess } from './file-policy.js';

const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);

function extractFilePath(toolInput: Record<string, unknown>): string | undefined {
  const candidates = ['path', 'filePath', 'file_path', 'file'];
  for (const key of candidates) {
    if (typeof toolInput[key] === 'string') return toolInput[key] as string;
  }
  return undefined;
}

export function createFilePolicyHook(): PreToolUseHook {
  return {
    name: 'security:file-policy',
    type: 'preToolUse',
    priority: 900,
    handler: (event: PreToolUseEvent): ToolHookDecision => {
      if (!FILE_TOOLS.has(event.toolName)) return { decision: 'skip' };

      const filePath = extractFilePath(event.toolInput);
      if (!filePath) return { decision: 'skip' };

      const result = checkFileAccess(filePath);
      if (!result.allowed) {
        return { decision: 'deny', reason: result.reason ?? 'file access denied' };
      }

      return { decision: 'allow' };
    },
  };
}
