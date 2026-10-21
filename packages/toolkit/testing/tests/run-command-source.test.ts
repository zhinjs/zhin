import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineCommand } from '@zhin.js/command';
import { describe, expect, it } from 'vitest';
import { createFakeMessage, createFakePlugin, runCommand } from '../src/index.js';

const definition = defineCommand({
  params: { definition: { type: 'string', rest: true } },
  execute: ({ params }) => `defined: ${String(params.definition)}`,
});

describe('runCommand({ source })', () => {
  it('rejects a layout the Runtime rejects (dynamic segment before the last one)', async () => {
    const fake = createFakePlugin();
    // Without source the definition runs, although the Runtime would refuse to load this layout.
    await expect(runCommand(fake, definition, { params: { definition: 'x' } })).resolves.toBe('defined: x');
    await expect(runCommand(fake, definition, {
      source: pathToFileURL(resolve('/plugin/commands/term/[word]/[...definition]/index.ts')),
      params: { definition: 'x' },
    })).rejects.toThrow(/the dynamic segment "\$word" must be the only dynamic segment/);
    await fake.dispose();
  });

  it('runs a valid convention command and accepts a path or a file URL', async () => {
    const fake = createFakePlugin();
    const input = createFakeMessage({ content: 'term hello world' });
    await expect(runCommand(fake, definition, {
      source: '/plugin/commands/term/[...definition]/index.ts', input, params: { definition: 'hello world' },
    })).resolves.toBe('defined: hello world');
    await expect(runCommand(fake, definition, {
      source: pathToFileURL(resolve('/plugin/commands/term/[...definition]')).href, params: { definition: 'y' },
    })).resolves.toBe('defined: y');
    await fake.dispose();
  });

  it('reports a params declaration that does not match the directory', async () => {
    const fake = createFakePlugin();
    const plain = defineCommand({ execute: () => 'ok' });
    await expect(runCommand(fake, plain, { source: '/plugin/commands/echo/[text]/index.ts' }))
      .rejects.toThrow(/missing params\.text/);
    await fake.dispose();
  });
});
