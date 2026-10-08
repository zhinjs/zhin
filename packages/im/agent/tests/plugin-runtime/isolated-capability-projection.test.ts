import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('recognizes actual native generation projections while retaining scope retirement and version boundaries', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/isolated-capability-projection.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--conditions=development', '--import', 'tsx', fixture], { cwd: process.cwd() });
  const result = JSON.parse(stdout.trim());
  expect(result.results).toHaveLength(4);
  for (const projection of result.results) {
    expect(projection).toMatchObject({ sameClass: false, guard: true, rejectFuture: false, rejectUnbranded: false });
  }
  expect(result.toolNames).toHaveLength(1);
  expect(result.echoed).toEqual({ message: 'isolated-module-echo' });
  expect(result.inactiveRejected).toBe(true);
}, 15_000);


it('binds a reused native Tool projection to each operation snapshot while preserving an old in-flight request', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/reused-tool-context.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--conditions=development', '--import', 'tsx', fixture], { cwd: process.cwd() });
  const result = JSON.parse(stdout.trim());
  expect(result.reusedProjection).toBe(true);
  expect(result.currentValue).toEqual({ generation: 8, config: 'new-config', resource: 'new-resource', projection: 'new-projection' });
  expect(result.oldValue).toEqual({ generation: 7, config: 'old-config', resource: 'old-resource', projection: 'old-projection' });
  expect(result.retired).toBe(true);
}, 15_000);
