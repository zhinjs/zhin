import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { formatOutboundBody, resolveLarkConfig } from '../src/protocol.js';
import upload from '../agents/lark/skills/lark/tools/upload_file/index.js';

it('passes operation language through the endpoint to generated link buttons without translating author content', async () => {
  const bodies: any[] = [];
  const endpoint = new LarkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'),
    config: resolveLarkConfig({ id: 'fixture', appId: 'fixture', appSecret: 'fixture', mode: 'websocket' }),
    fetch: async (url, options) => {
      if (!url.includes('/auth/')) bodies.push(JSON.parse(String(options?.body)));
      return { ok: true, status: 200, text: async () => '', json: async () => url.includes('/auth/') ? { code: 0, tenant_access_token: 'fixture', expire: 7200 } : { code: 0, data: { message_id: 'message-1' } } };
    },
  });
  const payload = [{ type: 'share', data: { title: '保留中文标题', description: '原文内容', url: 'https://example.test/article' } },
    { type: 'keyboard', data: { rows: [[{ label: '确认', payload: 'unchanged-action' }]] } }];
  await endpoint.send({ locale: 'en', conversation: { endpoint: { id: 'fixture', adapter: 'lark' }, kind: 'group', id: 'room' }, payload });
  const content = JSON.parse(bodies[0].content);
  expect(content.elements[0].text.content).toBe('保留中文标题');
  expect(content.elements[1].text.content).toBe('原文内容');
  expect(content.elements[2].actions[0].text.content).toBe('Open link');
  expect(content.elements[3].actions[0].text.content).toBe('确认');
  expect(content.elements[3].actions[0].value.zhin_payload).toBe('unchanged-action');
  expect(formatOutboundBody(payload).content).toContain('打开链接');
  await endpoint.stop();
});

it('reports an upload without a returned file key as failure in the current language', async () => {
  const uploadFile = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('file-key');
  expect(await upload.execute({ file_path: '/synthetic/file', file_type: 'file' }, { locale: 'en', $client: { uploadFile } } as never))
    .toEqual({ success: false, file_key: null, message: 'File upload failed; no file key was returned.' });
  expect(await upload.execute({ file_path: '/synthetic/file', file_type: 'file' }, { locale: 'en', $client: { uploadFile } } as never))
    .toMatchObject({ success: true, file_key: 'file-key' });
  expect(uploadFile).toHaveBeenCalledTimes(2);
});
