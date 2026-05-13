/**
 * write_file — 内置文件写入
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { assertFileAccess } from '../security/file-policy.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const WRITE_FILE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: '要写入的文件路径' },
    content: { type: 'string', description: '要写入的完整内容' },
  },
  required: ['file_path', 'content'],
};

export class WriteFileBuiltinTool extends BuiltinBaseTool {
  readonly name = 'write_file';
  readonly description =
    '向指定路径写入内容，创建或覆盖文件；若目录不存在会自动创建。';
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

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const filePathArg = args.file_path;
    const contentArg = args.content;
    if (typeof filePathArg !== 'string' || !filePathArg.trim()) {
      return 'Error: file_path is required';
    }
    if (typeof contentArg !== 'string') {
      return 'Error: content is required';
    }
    try {
      const fp = expandHome(filePathArg);
      assertFileAccess(fp);
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
