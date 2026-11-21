import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleUserActions, defaultConsoleCliIo, runConsoleInit, type ConsoleAdmin, type ConsoleCliIo } from '../src/commands/console.js';
import { setupOnboardingDeps } from '../src/commands/setup-onboarding.js';
import { NonInteractiveError, stdinIsInteractive } from '../src/utils/interactive.js';

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zcnt-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  return root;
}

/** An io without a terminal: any prompt would hang forever in the real CLI. */
function pipedIo(stdin = 'correct-horse-battery\n'): ConsoleCliIo & { logs: string[]; errors: string[]; prompt: ReturnType<typeof vi.fn> } {
  const io = {
    logs: [] as string[],
    errors: [] as string[],
    log: (message: string) => { io.logs.push(message); },
    error: (message: string) => { io.errors.push(message); },
    readStdin: async () => stdin,
    prompt: vi.fn(async () => { throw new Error('prompt must not run without a terminal'); }),
    interactive: () => false,
    hostRunning: async () => false,
  };
  return io as never;
}

function fakeAdmin() {
  const created: unknown[] = [];
  const closed = vi.fn(async () => undefined);
  const admin = {
    via: 'database',
    status: async () => ({ setupRequired: true, database: { dialect: 'sqlite', source: 'default' } }),
    drivers: async () => [],
    testDatabase: async () => ({ ok: true }),
    applyDatabase: async () => ({ notice: '', switched: false }),
    createOwner: async (input: { username: unknown }) => ({ user: { username: input.username } }),
    users: {
      list: async () => [],
      create: async (input: { username: string }) => { created.push(input); return { username: input.username }; },
      passwd: async (username: string) => ({ username }),
      setDisabled: async (username: string) => ({ username }),
    },
    close: closed,
  } as unknown as ConsoleAdmin;
  return { admin, open: async () => admin, created, closed };
}

describe('CLI prompts without a terminal (#1250 console-user-create-hangs-without-tty)', () => {
  it('zhin console user create without --password-stdin fails at once instead of prompting', async () => {
    const root = await project();
    const fake = fakeAdmin();
    const io = pipedIo();
    expect(await consoleUserActions.create(root, 'x', { role: 'viewer' }, io, fake.open)).toBe(1);
    expect(io.prompt).not.toHaveBeenCalled();
    expect(fake.created).toEqual([]);
    expect(fake.closed).toHaveBeenCalled();
    expect(io.errors).toHaveLength(1);
    expect(io.errors[0]).toContain('标准输入不是终端');
    expect(io.errors[0]).toContain('--password-stdin');
  });

  it('zhin console user passwd without --password-stdin fails the same way', async () => {
    const root = await project();
    const io = pipedIo();
    expect(await consoleUserActions.passwd(root, 'x', {}, io, fakeAdmin().open)).toBe(1);
    expect(io.prompt).not.toHaveBeenCalled();
    expect(io.errors[0]).toContain('--password-stdin');
  });

  it('--password-stdin still works without a terminal', async () => {
    const root = await project();
    const fake = fakeAdmin();
    const io = pipedIo('correct-horse-battery\n');
    expect(await consoleUserActions.create(root, 'x', { role: 'viewer', passwordStdin: true }, io, fake.open)).toBe(0);
    expect(fake.created).toEqual([{ username: 'x', password: 'correct-horse-battery', role: 'viewer' }]);
  });

  it('zhin console init (interactive wizard, or --owner without --password-stdin) fails without a terminal', async () => {
    vi.spyOn(setupOnboardingDeps, 'createService').mockReturnValue({} as never);
    const root = await project();
    const wizard = pipedIo();
    expect(await runConsoleInit(root, {}, wizard, fakeAdmin().open)).toBe(1);
    expect(wizard.prompt).not.toHaveBeenCalled();
    expect(wizard.errors[0]).toContain('--owner <name> --password-stdin');

    const ownerOnly = pipedIo();
    expect(await runConsoleInit(root, { owner: 'root' }, ownerOnly, fakeAdmin().open)).toBe(1);
    expect(ownerOnly.prompt).not.toHaveBeenCalled();
    expect(ownerOnly.errors[0]).toContain('--password-stdin');
  });

  it('the default io reports standard input as interactive only on a terminal', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      expect(defaultConsoleCliIo.interactive?.()).toBe(false);
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      expect(defaultConsoleCliIo.interactive?.()).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    expect(stdinIsInteractive({ isTTY: true })).toBe(true);
    expect(stdinIsInteractive({})).toBe(false);
    expect(new NonInteractiveError('X', 'hint').message).toBe('X需要交互式终端（标准输入不是终端）：hint');
  });
});
