/**
 * read_file — 内置文件读取（PRD #389 竖切1）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import {
  isBlockedDevicePath,
  MAX_READ_FILE_SIZE,
} from '../security/file-policy.js';
import { checkFilePermission, formatFilePermissionMessage, toolRequesterRoleToFileRole } from '../security/file-role-policy.js';
import { checkFileToolAccess, checkSensitiveFilePathAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
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
      description: '要读取的文件路径（绝对路径或相对项目根目录）',
    },
    offset: { type: 'number', description: '起始行号（0-based，可选，默认从第 1 行开始）' },
    limit: { type: 'number', description: '最多读取行数（可选，默认全部）' },
  },
  required: ['file_path'],
};

export class ReadFileBuiltinTool extends BuiltinBaseTool {
  readonly name = 'read_file';
  readonly description =
    '读取指定路径的文本文件内容。图片/音频/视频请使用 analyze_media，不要用 read_file。';
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

    // 第 1 层：角色门控（所有角色均可读取，但需走统一流程）
    const roleDecision = checkFileToolAccess('read_file', commMessage);
    if (!roleDecision.allowed) {
      if (roleDecision.needsOwnerApproval) return toOwnerSignal(roleDecision);
      return toDenyError(roleDecision);
    }

    // 第 2 层：文件角色权限矩阵（user 只有 read 权限，安全放行）
    const fileRole = toolRequesterRoleToFileRole(roleDecision.role);
    const permResult = checkFilePermission(fileRole, 'read', filePathArg);
    if (!permResult.allowed) {
      return formatFilePermissionMessage(permResult, 'read_file');
    }

    // 第 3 层：敏感路径检测 + 文件操作
    try {
      const fp = expandHome(filePathArg);
      const sensitiveDecision = checkSensitiveFilePathAccess('read_file', fp, commMessage);
      if (!sensitiveDecision.allowed) {
        if (sensitiveDecision.needsOwnerApproval) return toOwnerSignal(sensitiveDecision);
        return toDenyError(sensitiveDecision);
      }
      if (isBlockedDevicePath(fp)) {
        return `Error: 禁止读取设备文件 ${fp}（会导致进程挂起或注入攻击）`;
      }
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