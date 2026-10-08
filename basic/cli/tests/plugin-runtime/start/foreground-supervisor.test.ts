import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('@zhin.js/runtime', () => ({ supportsNativeTypeScript: () => true }));
import { NativeTypeScriptSupervisor } from '../../../src/plugin-runtime/start/process-supervisor.js';
import { parseStartOptions } from '../../../src/plugin-runtime/start/options.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); spawn.mockReset(); });

it('supervises foreground native-TS startup so intentional process restarts have an owner', async () => {
  vi.stubEnv('ZHIN_RUNTIME_CHILD', '');
  const previousExitCode = process.exitCode;
  spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  });
  try {
    expect(await new NativeTypeScriptSupervisor('/private/tmp', parseStartOptions(['--no-watch'])).runIfRequired()).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ stdio: 'inherit', env: { ZHIN_RUNTIME_CHILD: '1' } });
    expect(process.exitCode).toBe(0);
  } finally { process.exitCode = previousExitCode; }
});

it('does not recursively supervise an already supervised child', async () => {
  vi.stubEnv('ZHIN_RUNTIME_CHILD', '1');
  expect(await new NativeTypeScriptSupervisor('/private/tmp', parseStartOptions([])).runIfRequired()).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
});
