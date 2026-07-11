import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getIcqqAgentDeps } from '../../src/icqq-agent-deps.js';
export default defineTool<{ endpoint_id: string; group_id: number }>({
  description: '获取 QQ 群的群文件列表',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    group_id: z.number().describe('群号'),
  }),
  platforms: ['icqq'],
  tags: ['icqq'],
  async execute({ endpoint_id, group_id    }: { endpoint_id: string; group_id: number }) {
    const { Actions } = await import('../../src/protocol.js');
    const endpoint = getIcqqAgentDeps().getEndpoint(endpoint_id);
    const resp = await endpoint.ipc.request(Actions.GFS_LIST, { group_id });
    if (!resp.ok) throw new Error(resp.error ?? '获取群文件失败');
    const files = Array.isArray(resp.data) ? resp.data : [];
    if (!files.length) return { files: [], message: '群文件为空' };
    return {
      files: files.slice(0, 30).map((f: { name: string; size: number; uploader_uin: string; upload_time: number }) => ({
        name: f.name, size: f.size, uploader: f.uploader_uin, upload_time: f.upload_time,
      })),
      count: files.length,
    };
  },
});

