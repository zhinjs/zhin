/**
 * edit_file — 内置查找替换编辑
 */
import * as fs from 'node:fs/promises';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import {
  MAX_EDIT_FILE_SIZE,
  isFileStale,
} from '../security/file-policy.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import {
  findActualStringInFile,
  preserveQuoteStyleInEdit,
} from './file-edit-quote-utils.js';

export const EDIT_FILE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'File path to edit' },
    old_string: {
      type: 'string',
      description: 'Exact text to replace in the file (must match file content exactly)',
    },
    new_string: { type: 'string', description: 'Replacement text' },
  },
  required: ['file_path', 'old_string', 'new_string'],
};

export class EditFileBuiltinTool extends BuiltinBaseTool {
  readonly name = 'edit_file';
  readonly description =
    'Find and replace text in a file. old_string must exist exactly once; include full lines or enough context. Supports curly/straight quote normalization.';
  readonly parameters = EDIT_FILE_PARAMETERS;
  readonly kind = 'file';

  constructor() {
    super();
    this.tags.push('file', 'edit');
    this.keywords.push(
      '编辑文件',
      '修改文件',
      '替换内容',
      '查找替换',
      'edit file',
      'edit',
      '修改',
      '替换',
    );
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const filePathArg = args.file_path;
    const oldStringArg = args.old_string;
    const newStringArg = args.new_string;
    if (typeof filePathArg !== 'string' || !filePathArg.trim()) {
      return 'Error: file_path is required';
    }
    if (typeof oldStringArg !== 'string') {
      return 'Error: old_string is required';
    }
    if (typeof newStringArg !== 'string') {
      return 'Error: new_string is required';
    }

    // 统一安全策略门面（与原七层手写链等价）：
    // role-gate → dangerous-tool-approval → file-permission-matrix(update) →
    // memory-write-path → sensitive-path → blocked-device-path → workspace-access
    let fp: string;
    try {
      fp = expandHome(filePathArg);
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'edit');
    }
    const policyGate = toolPolicyResultToMessage(
      runToolPolicies({ toolName: 'edit_file', filePath: fp, rawFilePath: filePathArg, commMessage }),
      'edit_file',
    );
    if (policyGate) return policyGate;

    try {
      const stat = await fs.stat(fp);
      if (stat.size > MAX_EDIT_FILE_SIZE) {
        return `Error: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MiB)，超过 ${MAX_EDIT_FILE_SIZE / 1024 / 1024} MiB 限制。`;
      }
      const mtimeBefore = stat.mtimeMs;
      const content = await fs.readFile(fp, 'utf-8');

      const matchResult = findActualStringInFile(content, oldStringArg);
      if (!matchResult) {
        return 'Error: old_string not found in file. Make sure it matches exactly (also tried quote normalization).';
      }
      if (matchResult.count > 1) {
        return `Warning: old_string appears ${matchResult.count} times. Please provide more context to make it unique.`;
      }

      const effectiveNew = matchResult.wasNormalized
        ? preserveQuoteStyleInEdit(oldStringArg, matchResult.actual, newStringArg)
        : newStringArg;

      const newContent = content.replace(matchResult.actual, effectiveNew);

      const currentStat = await fs.stat(fp);
      if (isFileStale(mtimeBefore, currentStat.mtimeMs)) {
        return `Error: 文件 ${fp} 在读取后被外部修改。请重新读取文件后再编辑，避免覆盖他人的修改。`;
      }
      await fs.writeFile(fp, newContent, 'utf-8');

      const oldLines = oldStringArg.split('\n');
      const newLines = newStringArg.split('\n');
      return `✅ Edited ${fp}\n--- before ---\n${oldLines.slice(0, 5).join('\n')}${oldLines.length > 5 ? '\n...' : ''}\n--- after ---\n${newLines.slice(0, 5).join('\n')}${newLines.length > 5 ? '\n...' : ''}`;
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'edit');
    }
  }
}

export function createEditFileTool(): Tool {
  return new EditFileBuiltinTool().toTool();
}