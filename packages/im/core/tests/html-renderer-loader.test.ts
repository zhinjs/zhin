import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadHtmlRenderer,
  resetHtmlRendererLoaderForTests,
  seedHtmlRenderer,
} from '../src/built/html-renderer-loader.js';
import { resolveOptionalPeerPackage } from '../src/built/optional-peer-import.js';

describe('optional peer import', () => {
  beforeEach(() => {
    resetHtmlRendererLoaderForTests();
  });

  it('resolveOptionalPeerPackage finds html-renderer from monorepo root cwd', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const prev = process.cwd();
    process.chdir(root);
    try {
      const resolved = resolveOptionalPeerPackage('@zhin.js/html-renderer');
      expect(resolved).toBeTruthy();
      expect(resolved).toContain('html-renderer');
    } finally {
      process.chdir(prev);
    }
  });

  it('seedHtmlRenderer skips dynamic import', async () => {
    seedHtmlRenderer({
      render: async () => ({
        format: 'png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        data: Buffer.from('x'),
      }),
    });
    const r = await loadHtmlRenderer();
    expect(r).toBeTruthy();
  });

  it('loadHtmlRenderer resolves from test-bot project root', async () => {
    const testBotRoot = path.resolve(import.meta.dirname, '../../../../examples/test-bot');
    const prev = process.env.ZHIN_PROJECT_ROOT;
    process.env.ZHIN_PROJECT_ROOT = testBotRoot;
    try {
      const loaderPath = path.resolve(
        import.meta.dirname,
        '../lib/built/html-renderer-loader.js',
      );
      const { loadHtmlRenderer: loadFromLib, resetHtmlRendererLoaderForTests: reset } =
        await import(pathToFileURL(loaderPath).href);
      reset();
      const r = await loadFromLib({});
      expect(r).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.ZHIN_PROJECT_ROOT;
      else process.env.ZHIN_PROJECT_ROOT = prev;
    }
  });
});
