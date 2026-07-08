/**
 * write_file — 内置文件写入
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { checkFileAccess, isBlockedDevicePath } from '../security/file-policy.js';
import { checkMemoryWritePath } from '../memory-layers.js';
import { checkFilePermission, formatFilePermissionMessage, toolRequesterRoleToFileRole } from '../security/file-role-policy.js';
import { checkFileToolAccess, checkSensitiveFilePathAccess, checkDangerousToolAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
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

    // 第 1 层：角色门控（dangerous-tool-policy 从 bot 配置动态获取角色）
    const roleDecision = checkFileToolAccess('write_file', commMessage);
    if (!roleDecision.allowed) {
      if (roleDecision.needsOwnerApproval) return toOwnerSignal(roleDecision);
      return toDenyError(roleDecision);
    }

    // 第 1.5 层：危险工具审批（admin 调用 write_file 需 execAllowlist 或 Owner 确认）
    const dangerousDecision = checkDangerousToolAccess('write_file', commMessage);
    if (!dangerousDecision.allowed) {
      if (dangerousDecision.needsOwnerApproval) return toOwnerSignal(dangerousDecision);
      return toDenyError(dangerousDecision);
    }

    // 第 2 层：文件角色权限矩阵（file-role-policy）
    const fileRole = toolRequesterRoleToFileRole(roleDecision.role);
    const permResult = checkFilePermission(fileRole, 'create', filePathArg);
    if (!permResult.allowed) {
      return formatFilePermissionMessage(permResult, 'write_file');
    }
    const confirmMsg = formatFilePermissionMessage(permResult, 'write_file');
    if (confirmMsg) return confirmMsg;

    try {
      const fp = expandHome(filePathArg);
      const memoryDecision = checkMemoryWritePath(fp, commMessage);
      if (!memoryDecision.allowed) {
        return `Error: ${memoryDecision.reason}`;
      }

      // 第 3 层：敏感路径检测（dangerous-tool-policy + file-policy）
      const sensitiveDecision = checkSensitiveFilePathAccess('write_file', fp, commMessage);
      if (!sensitiveDecision.allowed) {
        if (sensitiveDecision.needsOwnerApproval) return toOwnerSignal(sensitiveDecision);
        return toDenyError(sensitiveDecision);
      }
      if (isBlockedDevicePath(fp)) {
        return `Error: 禁止访问设备路径: ${fp}`;
      }
      const access = checkFileAccess(fp);
      if (!access.allowed) {
        return `ZHIN_NEEDS_OWNER:\n${access.reason!}\n\n（文件访问策略拒绝；仅 Owner 确认后在受控环境可重试或调整策略。）`;
      }
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