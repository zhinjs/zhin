/**
 * #1250: lifecycle of the short-lived metadata worker. A stopped (old) worker's exit must not
 * answer — in-process, loading TypeScript on the main thread — requests that a newer worker
 * owns, and every worker must become unreferenced and stop once idle so the process can exit.
 *
 * The in-process parser is wrapped in spies; this file never calls it directly, so TypeScript is
 * only loaded on the main thread when the worker path falls back.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const inProcess = vi.hoisted(() => ({ page: vi.fn(), layout: vi.fn() }));

vi.mock('../../src/client-build/static-metadata.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/client-build/static-metadata.js')>();
  inProcess.page.mockImplementation(original.extractPageMetadata);
  inProcess.layout.mockImplementation(original.assertLayoutModule);
  return { ...original, extractPageMetadata: inProcess.page, assertLayoutModule: inProcess.layout };
});

const {
  isClientMetadataWorkerReferenced,
  isClientMetadataWorkerRunning,
  readClientMetadata,
  resetClientMetadataWorkerForTests,
  stopClientMetadataWorker,
} = await import('../../src/client-build/metadata-worker.js');

const staticMetadataRequire = createRequire(new URL('../../src/client-build/static-metadata.ts', import.meta.url));
const typescriptPath = staticMetadataRequire.resolve('typescript');
const typescriptLoadedOnMainThread = (): boolean => staticMetadataRequire.cache[typescriptPath] !== undefined;

afterEach(() => {
  resetClientMetadataWorkerForTests();
  inProcess.page.mockClear();
  inProcess.layout.mockClear();
});

const pageSource = (title: string): string => [
  "import { definePage } from '@zhin.js/console-contract';",
  `export const meta = definePage({ title: '${title}' });`,
  'export default 1;',
].join('\n');

describe('metadata worker lifecycle', () => {
  it('answers a request made right after a stop from the new worker, then releases it', async () => {
    expect(typescriptLoadedOnMainThread()).toBe(false);
    expect(await readClientMetadata('page', pageSource('First'), '/x/first.ts')).toEqual({ title: 'First' });

    // Stop the worker and ask again before the old worker has exited: its `exit` event arrives
    // while the new worker (still loading TypeScript) owns the request.
    stopClientMetadataWorker();
    const second = readClientMetadata('page', pageSource('Second'), '/x/second.ts');
    expect(isClientMetadataWorkerRunning()).toBe(true);
    expect(isClientMetadataWorkerReferenced()).toBe(true);
    expect(await second).toEqual({ title: 'Second' });

    // Answered by the new worker, not in-process by the old worker's exit handler.
    expect(inProcess.page).not.toHaveBeenCalled();
    expect(typescriptLoadedOnMainThread()).toBe(false);
    // Idle: no longer keeps the process alive, and stops after the idle timeout.
    expect(isClientMetadataWorkerRunning()).toBe(true);
    expect(isClientMetadataWorkerReferenced()).toBe(false);
    await vi.waitFor(() => expect(isClientMetadataWorkerRunning()).toBe(false), { timeout: 6_000, interval: 100 });
  });

  it('serves a burst spread over several workers without in-process fallback', async () => {
    const results: Promise<unknown>[] = [];
    for (let round = 0; round < 3; round += 1) {
      results.push(readClientMetadata('page', pageSource(`R${round}`), `/x/r${round}.ts`));
      results.push(readClientMetadata('layout', 'export default function L() {}', `/x/l${round}.tsx`));
      // Requests in flight on the stopped worker are answered in-process (its exit owes them);
      // only stop once this round has been answered, so nothing is owed.
      await Promise.all(results);
      stopClientMetadataWorker();
    }
    expect(await Promise.all(results)).toEqual([
      { title: 'R0' }, undefined, { title: 'R1' }, undefined, { title: 'R2' }, undefined,
    ]);
    expect(inProcess.page).not.toHaveBeenCalled();
    expect(inProcess.layout).not.toHaveBeenCalled();
    expect(isClientMetadataWorkerRunning()).toBe(false);
  });

  it('answers what a stopped worker still owed in-process', async () => {
    const owed = readClientMetadata('page', pageSource('Owed'), '/x/owed.ts');
    stopClientMetadataWorker();
    expect(await owed).toEqual({ title: 'Owed' });
    expect(inProcess.page).toHaveBeenCalledTimes(1);
  });

  it('parses in-process from then on when the worker cannot load static-metadata', async () => {
    resetClientMetadataWorkerForTests({ moduleUrl: new URL('./missing-static-metadata.js', import.meta.url).href });
    const pending = readClientMetadata('page', pageSource('Fallback'), '/x/fallback.ts');
    expect(isClientMetadataWorkerRunning()).toBe(true);
    expect(await pending).toEqual({ title: 'Fallback' });
    expect(inProcess.page).toHaveBeenCalledTimes(1);
    expect(isClientMetadataWorkerRunning()).toBe(false);

    // No new worker is started; errors keep their in-process form.
    await expect(readClientMetadata('layout', 'export const notDefault = 1;', '/x/layout.ts')).rejects.toMatchObject({
      name: 'ClientSourceError',
    });
    expect(inProcess.layout).toHaveBeenCalledTimes(1);
    expect(isClientMetadataWorkerRunning()).toBe(false);
  });
});
