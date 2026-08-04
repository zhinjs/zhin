/**
 * analyze_media — 分析本地图片/音频/视频（base64 路由）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, MediaRef, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { expandHome, nodeErrToFileMessage } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { normalizeMediaRefsToPayloads } from '../media/media-normalize.js';
import { preprocessInboundMedia } from '../media/media-router.js';
import { resolveMultimodalConfig } from '../media/resolve-config.js';

const MEDIA_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.mp3', '.wav', '.ogg', '.m4a',
  '.mp4', '.webm', '.mov', '.mkv',
]);

function isMediaPath(filePath: string): boolean {
  return MEDIA_EXT.has(path.extname(filePath).toLowerCase());
}

export const ANALYZE_MEDIA_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'Media file path (image/audio/video)' },
  },
  required: ['file_path'],
};

export class AnalyzeMediaBuiltinTool extends BuiltinBaseTool {
  readonly name = 'analyze_media';
  readonly description =
    'Analyze a local image, audio, or video file and return a readable summary (transcript/dimensions/format). Do not use read_file for media files.';
  readonly parameters = ANALYZE_MEDIA_PARAMETERS;
  readonly kind = 'file';

  constructor() {
    super();
    this.tags.push('file', 'media');
    this.keywords.push('分析图片', '分析视频', '分析音频', 'analyze media', 'vision', '媒体');
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const filePathArg = args.file_path;
    if (typeof filePathArg !== 'string' || !filePathArg.trim()) {
      return 'Error: file_path is required';
    }

    // 统一安全策略门面（与原三层手写链等价，旧链以 read_file 身份执行）：
    // role-gate(read_file) → file-permission-matrix(read) → sensitive-path
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
        commMessage,
      }),
      'analyze_media',
    );
    if (policyGate) return policyGate;

    try {
      if (!isMediaPath(fp)) {
        return 'Error: analyze_media 仅支持图片/音频/视频扩展名；文本请用 read_file。';
      }
      const stat = await fs.stat(fp);
      const buf = await fs.readFile(fp);
      const mm = resolveMultimodalConfig();
      if (buf.length > mm.maxFileBytes) {
        return `Error: 文件过大 (${(buf.length / 1024 / 1024).toFixed(1)} MiB)，超过上限。`;
      }

      const ext = path.extname(fp).toLowerCase();
      const base64 = buf.toString('base64');
      const fileName = path.basename(fp);
      let ref: { type: string; media: MediaRef };
      if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
        ref = { type: 'audio', media: { kind: 'base64', value: base64, mime_type: ext === '.wav' ? 'audio/wav' : 'audio/mpeg', file_name: fileName } };
      } else if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
        ref = { type: 'video', media: { kind: 'base64', value: base64, mime_type: 'video/mp4', file_name: fileName } };
      } else {
        const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        ref = { type: 'image', media: { kind: 'base64', value: base64, mime_type: mime, file_name: fileName } };
      }

      const payloads = await normalizeMediaRefsToPayloads([ref], mm.maxFileBytes);
      const pre = await preprocessInboundMedia(payloads, mm);
      const lines = [
        `File: ${fp}`,
        `Size: ${(stat.size / 1024).toFixed(1)} KB`,
        `Payloads: ${payloads.length}`,
        '',
        pre.textAppend || '(无附加说明)',
      ];
      if (pre.visionParts.length) {
        lines.push('', `Vision parts: ${pre.visionParts.length} image(s) ready for model.`);
      }
      return lines.join('\n');
    } catch (e: unknown) {
      return nodeErrToFileMessage(e, String(filePathArg), 'read');
    }
  }
}

export function createAnalyzeMediaTool(): Tool {
  return new AnalyzeMediaBuiltinTool().toTool();
}
