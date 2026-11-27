// #1250 run-supervised-instance-orphan (plan b): `runSupervisedInstance` stays exported (deprecated,
// `zhin start` uses `runGateway`); its exit codes and `.zhin.pid` handling are covered here with a
// fake supervisor, no real instance.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartOptions } from '@zhin.js/runtime';

type Script = (supervisor: FakeSupervisor) => void | Promise<void>;

const fake = vi.hoisted(() => ({
  onStart: undefined as undefined | ((supervisor: unknown) => void | Promise<void>),
  onStop: undefined as undefined | ((supervisor: unknown, options: unknown) => void),
  instances: [] as unknown[],
}));

class FakeSupervisor extends EventEmitter {
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' = 'idle';
  lastExitCode: number | undefined;
  readonly stops: unknown[] = [];
  disposed = 0;
  constructor(readonly options: unknown) {
    super();
    fake.instances.push(this);
  }
  status() { return { state: this.state, lastExitCode: this.lastExitCode }; }
  settle(state: 'stopped' | 'crashed' | 'running', exitCode?: number): void {
    this.state = state;
    this.lastExitCode = exitCode;
    this.emit('state', state);
  }
  async start(): Promise<void> { await fake.onStart?.(this); }
  async stop(options: unknown): Promise<void> {
    this.stops.push(options);
    fake.onStop?.(this, options);
  }
  dispose(): void { this.disposed += 1; }
}

vi.mock('../../src/supervisor/instance-supervisor.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/supervisor/instance-supervisor.js')>(),
  InstanceSupervisor: FakeSupervisor,
}));

const { runSupervisedInstance } = await import('../../src/supervisor/run-instance.js');

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-run-instance-'))); });
afterEach(async () => {
  fake.onStart = undefined;
  fake.onStop = undefined;
  fake.instances.length = 0;
  await rm(root, { recursive: true, force: true });
});

const options = (extra: Partial<StartOptions> = {}): StartOptions => ({ daemon: false, once: false, ...extra } as StartOptions);
const run = (extra: Partial<StartOptions> = {}) => runSupervisedInstance({ root, options: options(extra), entry: '/fake/zhin.js', args: ['runtime', 'start'] });
const onStart = (script: Script): void => { fake.onStart = script as never; };

describe('runSupervisedInstance exit codes', () => {
  it('returns the exit code of a clean stop, 0 when there is none', async () => {
    onStart(supervisor => supervisor.settle('stopped', 0));
    expect(await run()).toBe(0);
    onStart(supervisor => supervisor.settle('stopped', undefined));
    expect(await run()).toBe(0);
    onStart(supervisor => supervisor.settle('stopped', 4));
    expect(await run()).toBe(4);
  });

  it('returns lastExitCode || 1 for a crash', async () => {
    onStart(supervisor => supervisor.settle('crashed', 7));
    expect(await run()).toBe(7);
    onStart(supervisor => supervisor.settle('crashed', 0));
    expect(await run()).toBe(1);
    onStart(supervisor => supervisor.settle('crashed', undefined));
    expect(await run()).toBe(1);
  });

  it('returns 130 when interrupted (or the instance exit code), and stops the supervisor on the signal', async () => {
    for (const [exitCode, expected] of [[undefined, 130], [2, 2]] as const) {
      const before = new Set(process.listeners('SIGINT'));
      fake.onStop = (supervisor) => (supervisor as FakeSupervisor).settle('stopped', exitCode);
      onStart(supervisor => {
        supervisor.settle('running');
        const added = process.listeners('SIGINT').filter(listener => !before.has(listener));
        expect(added).toHaveLength(1);
        (added[0] as () => void)();
      });
      expect(await run()).toBe(expected);
      const supervisor = fake.instances.at(-1) as FakeSupervisor;
      expect(supervisor.stops).toEqual([{ reason: 'signal', force: false }]);
      // Signal handlers are removed when the run ends.
      expect(process.listeners('SIGINT').filter(listener => !before.has(listener))).toEqual([]);
    }
  });
});

describe('runSupervisedInstance --daemon pid file', () => {
  it('writes .zhin.pid while running and removes it afterwards', async () => {
    const pidFile = join(root, '.zhin.pid');
    let during: string | undefined;
    onStart(supervisor => {
      during = readFileSync(pidFile, 'utf8');
      supervisor.settle('stopped', 0);
    });
    expect(await run({ daemon: true })).toBe(0);
    expect(during).toBe(String(process.pid));
    expect(existsSync(pidFile)).toBe(false);
    // The daemon captures output into the default log file location.
    expect(existsSync(join(root, '.zhin', 'logs'))).toBe(true);
  });

  it('leaves a pid file that belongs to another process', async () => {
    const pidFile = join(root, '.zhin.pid');
    onStart(supervisor => {
      writeFileSync(pidFile, '424242');
      supervisor.settle('stopped', 0);
    });
    await run({ daemon: true });
    expect(readFileSync(pidFile, 'utf8')).toBe('424242');
  });

  it('writes no pid file in the foreground', async () => {
    onStart(supervisor => {
      expect(existsSync(join(root, '.zhin.pid'))).toBe(false);
      supervisor.settle('stopped', 0);
    });
    await run();
    expect(existsSync(join(root, '.zhin.pid'))).toBe(false);
  });
});
