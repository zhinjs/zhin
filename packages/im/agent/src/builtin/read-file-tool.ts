/**
 * read_file — 内置文件读取（PRD #389 竖切1）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import {
  MAX_READ_FILE_SIZE,
} from '../security/file-policy.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export const READ_FILE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'File path to read (absolute or relative to project root)',
    },
    offset: { type: 'number', description: 'Start line (0-based, optional; default from line 1)' },
    limit: { type: 'number', description: 'Max lines to read (optional; default all)' },
  },
  required: ['file_path'],
};

export class ReadFileBuiltinTool extends BuiltinBaseTool {
  readonly name = 'read_file';
  readonly description =
    'Read text file contents at the given path. For images/audio/video use analyze_media, not read_file.';
  readonly parameters = READ_FILE_PARAMETERS;
  readonly kind = 'file';

  constructor() {
    super();
    this.tags.push('file', 'read');
    this.keywords.push(
      '读文件',
      '读取文件',
      '查看文件',
      '打开文件',
      '文件内容',
      'read file',
      'read',
      'cat',
      '查看',
      '打开',
    );
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const filePathArg = args.file_path;
    if (typeof filePathArg !== 'string' || !filePathArg.trim()) {
      return 'Error: file_path is required';
    }

    // 统一安全策略门面（与原四层手写链等价）：
    // role-gate → file-permission-matrix(read) → sensitive-path → blocked-device-path（读类措辞）
    let fp: string;
    try {
      fp = expandHome(filePathArg);
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'read');
    }
    const policyGate = toolPolicyResultToMessage(
      runToolPolicies({
        toolName: 'read_file',
        filePath: fp,
        rawFilePath: filePathArg,
        fileOperation: 'read',
        devicePathGuard: true,
        commMessage,
      }),
      'read_file',
    );
    if (policyGate) return policyGate;

    try {
      const stat = await fs.stat(fp);
      if (stat.size > MAX_READ_FILE_SIZE) {
        return `Error: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MiB)，超过 ${MAX_READ_FILE_SIZE / 1024 / 1024} MiB 限制。请使用 offset/limit 分段读取。`;
      }

      if (isImageFile(fp)) {
        return `Error: 请使用 analyze_media 分析图片文件: ${fp}`;
      }

      const content = await fs.readFile(fp, 'utf-8');
      const lines = content.split('\n');
      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const limit = typeof args.limit === 'number' ? args.limit : lines.length;
      const sliced = lines.slice(offset, offset + limit);
      const numbered = sliced.map((line: string, i: number) => `${offset + i + 1} | ${line}`).join('\n');
      return `File: ${fp} (${lines.length} lines, showing ${offset + 1}-${Math.min(offset + limit, lines.length)})\n${numbered}`;
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'read');
    }
  }
}

/** 工厂：供 createBuiltinTools 与其它入口使用 */
export function createReadFileTool(): Tool {
  return new ReadFileBuiltinTool().toTool();
}