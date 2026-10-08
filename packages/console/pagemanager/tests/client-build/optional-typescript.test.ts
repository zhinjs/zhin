import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';

it('loads static metadata without TypeScript and reports the peer only when compilation is requested', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'zhin-optional-typescript-'));
  try {
    const source = await readFile(new URL('../../src/client-build/static-metadata.ts', import.meta.url), 'utf8');
    await writeFile(join(fixture, 'static-metadata.mjs'), transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' }).code);
    await writeFile(join(fixture, 'probe.mjs'), `
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      try { require.resolve('typescript'); throw new Error('fixture unexpectedly has TypeScript'); }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
      const module = await import('./static-metadata.mjs');
      for (const parse of [module.extractPageMetadata, module.assertLayoutModule]) {
        try { parse('export default {}', 'page.tsx'); throw new Error('expected optional peer error'); }
        catch (error) {
          if (!error.message.includes('Console Page/Layout compilation requires the optional typescript peer dependency')) throw error;
          if (error.cause?.code !== 'MODULE_NOT_FOUND') throw error;
        }
      }
      console.log('import_without_compiler_and_explicit_build_error');
    `);
    const output = execFileSync(process.execPath, [join(fixture, 'probe.mjs')], { cwd: fixture, encoding: 'utf8' });
    expect(output.trim()).toBe('import_without_compiler_and_explicit_build_error');
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
