import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  file_path: string;
  file_type: 'image' | 'file' | 'video' | 'audio';
}>({
  description: '上传宿主机本地文件到飞书（image/file/video/audio；读取宿主文件，仅全局主人可用）',
  inputSchema: z.object({
    file_path: z.string().describe('本地文件路径'),
    file_type: z.enum(['image', 'file', 'video', 'audio']).default('file').describe('飞书文件类型'),
  }),
  adapter: 'lark',
  tags: ['lark'],
  // `file_path` is a path on the host: reading host files is a host-global capability (ADR 0056 §2).
  permissions: ['owner@global'],
  async execute({ file_path, file_type }: {
    file_path: string;
    file_type: 'image' | 'file' | 'video' | 'audio';
  }, context) {
    const endpoint = context.$client;
    const result = await endpoint.uploadFile(file_path, file_type);
    if (result === null) return { success: false, file_key: null, message: t(context.locale, 'fileUploadFailed') };
    return { success: true, file_key: result, message: t(context.locale, 'fileUploaded', { p0: result }) };
  },
});
