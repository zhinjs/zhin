import { mkdtemp, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeImageUploadToolFeature } from '../../src/plugin-runtime/native-image-upload-tool.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { R2ImageAssetPublisher } from '../../src/media/r2-image-assets.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-upload-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function fixture(approved = true) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  const assets = new R2ImageAssetPublisher({ accountId: 'a'.repeat(32), bucket: 'fixture', prefix: 'images/',
    accessKeyId: 'test', secretAccessKey: 'test', publicBaseUrl: 'https://images.example.test' }, fetchImpl);
  const native = createNativeImageUploadToolFeature(assets);
  const execute = vi.fn((input: Readonly<Record<string, unknown>>, context: unknown) => native.definition.execute({ ...input }, context as ToolExecutionContext));
  const approval = vi.fn(async () => approved);
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' }, identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'upload' }, principal: { subjectId: 'owner', roles: ['master'] },
    input: { text: 'upload' }, session: { key: 'upload' },
    policy: { permissions: ['master'], unattended: false, filesystem: { workspaceRoot: root } },
    capabilities: { tools: ['upload_image'], skills: [] }, signal: new AbortController().signal,
    ports: { journal: { append: event => { events.push(event); } }, approval: { requestApproval: approval } },
  });
  const runtime = new TurnToolRuntime(turn, [{ ...native.definition, execute, owner: rootPluginId(), name: native.name,
    qualifiedName: native.name, source: 'builtin' }]);
  return { runtime, fetchImpl, execute, approval, events };
}

it('requires fresh publication approval and uses the authorized canonical image path', async () => {
  await writeFile(join(root, 'sticker.gif'), gif);
  const { runtime, fetchImpl, execute, approval, events } = fixture();
  for (const id of ['one', 'two']) {
    await expect(runtime.execute('upload_image', { file_path: 'sticker.gif' }, id)).resolves.toMatchObject({ status: 'completed' });
  }
  expect(approval).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][0]).toEqual({ file_path: join(root, 'sticker.gif') });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(events)).not.toContain(gif.toString('base64'));
  expect(JSON.stringify(events)).toContain('https://images.example.test/images/');
});

it('does not read or upload a file after publication is denied', async () => {
  const { runtime, fetchImpl, execute } = fixture(false);
  await expect(runtime.execute('upload_image', { file_path: 'missing.gif' }, 'deny')).resolves.toMatchObject({ status: 'denied' });
  expect(execute).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('denies traversal, external symlinks and sensitive files before execution', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'zhin-outside-'));
  try {
    await writeFile(join(outside, 'image.gif'), gif);
    await symlink(join(outside, 'image.gif'), join(root, 'link.gif'));
    await writeFile(join(root, '.env'), 'SYNTHETIC_TEST_ONLY=true');
    const { runtime, execute, fetchImpl } = fixture();
    for (const file_path of [join(outside, 'image.gif'), '../outside.gif', 'link.gif', '.env']) {
      await expect(runtime.execute('upload_image', { file_path }, file_path)).resolves.toMatchObject({ status: 'denied' });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { await rm(outside, { recursive: true, force: true }); }
});

it('rejects fake image bytes and oversized files without an upload', async () => {
  await writeFile(join(root, 'fake.png'), '<html>not an image</html>');
  await writeFile(join(root, 'large.gif'), Buffer.alloc(26_214_401));
  const { runtime, fetchImpl } = fixture();
  for (const file_path of ['fake.png', 'large.gif']) {
    await expect(runtime.execute('upload_image', { file_path }, file_path)).resolves.toMatchObject({ status: 'failed' });
  }
  expect(fetchImpl).not.toHaveBeenCalled();
});
