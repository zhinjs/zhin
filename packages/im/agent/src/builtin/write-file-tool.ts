/**
 * write_file — 内置文件写入
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const WRITE_FILE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'File path to write' },
    content: { type: 'string', description: 'Full file content to write' },
  },
  required: ['file_path', 'content'],
};

export class WriteFileBuiltinTool extends BuiltinBaseTool {
  readonly name = 'write_file';
  readonly description =
    'Write content to a file path, creating or overwriting the file; creates parent directories if missing.';
  readonly parameters = WRITE_FILE_PARAMETERS;
  readonly kind = 'file';

  constructor() {
    super();
    this.tags.push('file', 'write');
    this.keywords.push(
      '写文件',
      '写入文件',
      '创建文件',
      '保存文件',
      'write file',
      'write',
      '保存',
      '创建',
    );
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const filePathArg = args.file_path;
    const contentArg = args.content;
    if (typeof filePathArg !== 'string' || !filePathArg.trim()) {
      return 'Error: file_path is required';
    }
    if (typeof contentArg !== 'string') {
      return 'Error: content is required';
    }

    // 统一安全策略门面（与原七层手写链等价）：
    // role-gate → dangerous-tool-approval → file-permission-matrix(create) →
    // memory-write-path → sensitive-path → blocked-device-path → workspace-access
    let fp: string;
    try {
      fp = expandHome(filePathArg);
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'write');
    }
    const policyGate = toolPolicyResultToMessage(
      runToolPolicies({ toolName: 'write_file', filePath: fp, rawFilePath: filePathArg, commMessage }),
      'write_file',
    );
    if (policyGate) return policyGate;

    try {
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, contentArg, 'utf-8');
      return `✅ Wrote ${Buffer.byteLength(contentArg)} bytes to ${fp}`;
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'write');
    }
  }
}

export function createWriteFileTool(): Tool {
  return new WriteFileBuiltinTool().toTool();
}