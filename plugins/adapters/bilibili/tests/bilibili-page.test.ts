import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TypeScriptClientBuilder, extractPageMetadata } from '@zhin.js/pagemanager/client-build';
import { pageFeatureId } from '@zhin.js/page';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = join(packageRoot, 'pages/index/index.tsx');
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('Comment review Console page', () => {
  it('declares plain-language static metadata gated by bilibili:read', async () => {
    expect(extractPageMetadata(await readFile(pageSource, 'utf8'), pageSource)).toMatchObject({
      title: '评论审批',
      titleI18n: { en: 'Comment review' },
      requiredPermissions: ['bilibili:read'],
    });
  });

  it('compiles into a client module artifact', async () => {
    const project = await mkdtemp(join(tmpdir(), 'zhin-bilibili-page-build-'));
    temporary.push(project);
    const builder = new TypeScriptClientBuilder({ projectRoot: packageRoot, outDir: join(project, 'dist/client'), publicBase: '/assets/client' });
    const artifact = await builder.load(pageSource, { feature: pageFeatureId, owner: 'root/bilibili', localName: 'index' });
    expect(artifact).toMatchObject({
      module: expect.stringMatching(/^\/assets\/client\//u),
      metadata: expect.objectContaining({ title: '评论审批' }),
    });
  });
});
