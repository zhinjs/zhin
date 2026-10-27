import type { AIProvider } from '@zhin.js/ai';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { runEvalCase } from '../../evals/framework/driver.js';
import { createNativeImageToolFeature } from '../../src/plugin-runtime/native-image-tool.js';
import { createNativeAgentToolSuite } from '../../src/plugin-runtime/native-tool-suite.js';
import { R2ImageAssetPublisher } from '../../src/media/r2-image-assets.js';
import { publishOutboundElements } from '../../src/media/media-publisher.js';

const base64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const context = { signal: new AbortController().signal } as ToolExecutionContext;
function fixture(status = 200) {
  const upload = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  const assets = new R2ImageAssetPublisher({ accountId: 'a'.repeat(32), bucket: 'fixture', prefix: 'images/',
    accessKeyId: 'test', secretAccessKey: 'test', publicBaseUrl: 'https://images.example.test' }, upload);
  const generateImage = vi.fn(async () => ({ base64, mimeType: 'image/gif', model: 'fixture' }));
  const resolveProvider = () => ({ generateImage }) as unknown as AIProvider;
  return { assets, upload, generateImage, resolveProvider };
}

it('keeps generated image bytes out of the tool journal, next completion and later-turn history', async () => {
  const { assets, generateImage, upload, resolveProvider } = fixture();
  const native = createNativeImageToolFeature(resolveProvider, undefined, assets);
  const result = await runEvalCase({
    id: 'r2-image-tool-context', description: 'Real native image tool through the full engine', source: 'Image base64 context regression',
    inbound: [{ text: '画一张图片' }, { text: '刚才图片的地址' }],
    tools: [{ name: 'generate_image', result: () => native.definition.execute({ provider_alias: 'fixture', prompt: 'cat' }, context) }],
    script: [
      { toolCalls: [{ name: 'generate_image' }] },
      { text: '图片已生成。' },
      { text: '这是刚才的图片。' },
    ], expect: {},
  }, { imageAssets: assets });
  expect(generateImage).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(result.modelRequests).toHaveLength(3);
  for (const request of result.modelRequests) expect(request.inputText).not.toContain(base64);
  for (const request of result.modelRequests.slice(1)) expect(request.inputText).toContain('https://images.example.test/images/');
  expect(JSON.stringify(result.events)).not.toContain(base64);
  const terminal = result.terminals[0];
  if (terminal.type !== 'turn_end') throw new Error('Missing terminal');
  const outgoing = await publishOutboundElements(terminal.output, 'icqq', undefined, { imageAssets: assets });
  expect(JSON.stringify(outgoing)).toContain('https://images.example.test/images/');
  expect(JSON.stringify(outgoing)).not.toContain(base64);
});

it('normalizes model-authored inline stickers before the terminal and later completion', async () => {
  const { assets, upload } = fixture();
  const result = await runEvalCase({
    id: 'r2-sticker-context', description: 'Inline structured image does not persist as base64', source: 'Sticker history regression',
    inbound: [{ text: '给我一张表情' }, { text: '上张表情是什么' }],
    script: [
      { segments: [{ type: 'image', data: { media: { kind: 'base64', value: base64, mime_type: 'image/gif' } } }] },
      { text: '上一张是 GIF。' },
    ], expect: {},
  }, { imageAssets: assets });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(result.modelRequests[1].inputText).not.toContain(base64);
  expect(result.modelRequests[1].inputText).toContain('https://images.example.test/images/');
  expect(JSON.stringify(result.events)).not.toContain(base64);
  expect(result.traces[0].usage.total_tokens).toBe(result.terminals[0].type === 'turn_end' ? result.terminals[0].usage.totalTokens : -1);
});

it('does not fall back to bytes or regenerate after an R2 failure', async () => {
  const { assets, upload, generateImage, resolveProvider } = fixture(503);
  const native = createNativeImageToolFeature(resolveProvider, undefined, assets);
  await expect(native.definition.execute({ provider_alias: 'fixture', prompt: 'cat' }, context)).rejects.toThrow('Do not regenerate automatically');
  expect(upload).toHaveBeenCalledTimes(1);
  expect(generateImage).toHaveBeenCalledTimes(1);
});

it('keeps upload unavailable without R2, and preserves publish approval in the shared suite', () => {
  const { assets, resolveProvider } = fixture();
  expect(createNativeAgentToolSuite({ resolveProvider }).some(tool => tool.name === 'upload_image')).toBe(false);
  const tool = createNativeAgentToolSuite({ resolveProvider, imageAssets: assets }).find(tool => tool.name === 'upload_image');
  expect(tool?.definition).toMatchObject({ risk: 'dangerous', riskCategory: 'publish', requiresApproval: 'human' });
});
