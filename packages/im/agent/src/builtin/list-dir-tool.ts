/**
 * list_dir — 列出目录内容
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
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
      // 统一安全策略门面（与原两层手写链等价）：role-gate → sensitive-path
      const policyGate = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'list_dir', filePath: dirPath, commMessage }),
        'list_dir',
      );
      if (policyGate) return policyGate;
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
