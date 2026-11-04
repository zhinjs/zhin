import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TypeScriptClientBuilder,
  extractPageMetadata,
} from '@zhin.js/pagemanager/client-build';

const temporary: string[] = [];
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = join(packageRoot, 'pages/index/index.ts');

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('telegram console page', () => {
  it('exposes static definePage metadata', async () => {
    const source = await readFile(pageSource, 'utf8');
    expect(extractPageMetadata(source, pageSource)).toMatchObject({
      title: 'Telegram',
      titleI18n: { en: 'Telegram' },
      icon: 'Send',
      requiredPermissions: ['telegram:read'],
    });
  });

  it('compiles into a client module artifact with the shared page bundle', async () => {
    const project = await mkdtemp(join(tmpdir(), 'zhin-telegram-page-build-'));
    temporary.push(project);
    const builder = new TypeScriptClientBuilder({
      projectRoot: packageRoot,
      outDir: join(project, 'dist/client'),
      publicBase: '/assets/client',
    });
    const artifact = await builder.load<{
      module: string;
      metadata: { title?: string };
    }>(pageSource, {
      feature: 'zhin.page',
      owner: 'root/telegram',
      localName: 'index',
    });
    expect(artifact.module).toMatch(/^\/assets\/client\//u);
    expect(artifact.metadata.title).toBe('Telegram');
    const contents = await readFile(
      join(project, 'dist/client', artifact.module.split('/').pop() ?? ''),
      'utf8',
    );
    // The page imports the shared client page; bare React imports stay external.
    expect(contents).toContain('createAdapterConsolePage');
  });
});
