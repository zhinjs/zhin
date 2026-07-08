/**
 * list_dir — 列出目录内容
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { checkFileToolAccess, checkSensitiveFilePathAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const LIST_DIR_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Directory path to list (absolute or relative to project root)',
    },
  },
  required: ['path'],
};

export class ListDirBuiltinTool extends BuiltinBaseTool {
  readonly name = 'list_dir';
  readonly description =
    'List file and subdirectory names in a directory. Use to inspect directory structure and available files.';
  readonly parameters = LIST_DIR_PARAMETERS;
  readonly kind = 'file';

  constructor() {
    super();
    this.tags.push('file', 'list');
    this.keywords.push(
      '列目录',
      '列出目录',
      '目录列表',
      '查看目录',
      'list directory',
      'list dir',
      'ls',
      'dir',
      '目录内容',
      '有哪些文件',
    );
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const pathArg = args.path;
    if (typeof pathArg !== 'string' || !pathArg.trim()) {
      return 'Error: path is required';
    }
    try {
      const dirPath = path.resolve(process.cwd(), expandHome(pathArg));
      const roleDecision = checkFileToolAccess('list_dir', commMessage);
      if (!roleDecision.allowed) {
        if (roleDecision.needsOwnerApproval) return toOwnerSignal(roleDecision);
        return toDenyError(roleDecision);
      }
      const sensitiveDecision = checkSensitiveFilePathAccess('list_dir', dirPath, commMessage);
      if (!sensitiveDecision.allowed) {
        if (sensitiveDecision.needsOwnerApproval) return toOwnerSignal(sensitiveDecision);
        return toDenyError(sensitiveDecision);
      }
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return `Error: Not a directory: ${pathArg}`;
      }
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      if (entries.length === 0) {
        return `Directory ${pathArg} is empty`;
      }
      const lines: string[] = [];
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push((e.isDirectory() ? '[DIR]  ' : '       ') + e.name);
      }
      return lines.join('\n');
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, pathArg, 'list');
    }
  }
}

export function createListDirTool(): Tool {
  return new ListDirBuiltinTool().toTool();
}
