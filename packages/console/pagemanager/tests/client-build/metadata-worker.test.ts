/**
 * #1250: Page/Layout static metadata is parsed in a short-lived worker so the TypeScript
 * compiler does not stay loaded in the instance. Results and errors must match the in-process
 * parser exactly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientSourceError,
  assertLayoutModule,
  extractPageMetadata,
} from '../../src/client-build/static-metadata.js';
import {
  isClientMetadataWorkerRunning,
  readClientMetadata,
  stopClientMetadataWorker,
} from '../../src/client-build/metadata-worker.js';

afterEach(() => stopClientMetadataWorker());

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

async function captureAsync(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('off-thread client metadata', () => {
  it('returns the same Page metadata as the in-process parser, from a worker', async () => {
    const source = [
      "import { definePage } from '@zhin.js/console-contract';",
      "export const meta = definePage({ title: 'Status', order: -2, keywords: { en: ['a', 'b'] }, hideInNav: false, icon: null });",
      'export default function Status() { return <main />; }',
    ].join('\n');
    const pending = readClientMetadata('page', source, '/x/pages/status.tsx');
    expect(isClientMetadataWorkerRunning()).toBe(true);
    expect(await pending).toEqual(extractPageMetadata(source, '/x/pages/status.tsx'));
    // Still running: the worker loaded the parser itself (a load failure falls back in-process
    // and stops the worker).
    expect(isClientMetadataWorkerRunning()).toBe(true);
    expect(await readClientMetadata('layout', 'export default function L() {}', '/x/layout.tsx')).toBeUndefined();
  });

  it('reports parse errors as the same ClientSourceError', async () => {
    const cases: [kind: 'page' | 'layout', source: string][] = [
      ['page', "import { definePage } from '@zhin.js/console-contract';\nexport const meta = definePage({ title: getTitle() });\nexport default 1;"],
      ['page', "export const meta = definePage({});\nexport default 1;"],
      ['layout', 'export const notDefault = 1;'],
    ];
    for (const [kind, source] of cases) {
      const fileName = `/x/${kind}.ts`;
      const expected = capture(() => (kind === 'page' ? extractPageMetadata(source, fileName) : assertLayoutModule(source, fileName)));
      const actual = await captureAsync(() => readClientMetadata(kind, source, fileName));
      expect(expected).toBeInstanceOf(ClientSourceError);
      expect(actual).toBeInstanceOf(ClientSourceError);
      expect(actual).toMatchObject({
        name: 'ClientSourceError',
        message: (expected as ClientSourceError).message,
        source: (expected as ClientSourceError).source,
        line: (expected as ClientSourceError).line,
        column: (expected as ClientSourceError).column,
      });
    }
  });

  it('serves concurrent requests and stops the worker on demand', async () => {
    const sources = Array.from({ length: 8 }, (_, index) => [
      "import { definePage } from '@zhin.js/console-contract';",
      `export const meta = definePage({ title: 'Page ${index}', order: ${index} });`,
      'export default 1;',
    ].join('\n'));
    const results = await Promise.all(sources.map((source, index) => readClientMetadata('page', source, `/x/p${index}.ts`)));
    expect(results).toEqual(sources.map((_, index) => ({ title: `Page ${index}`, order: index })));
    stopClientMetadataWorker();
    expect(isClientMetadataWorkerRunning()).toBe(false);
  });
});
