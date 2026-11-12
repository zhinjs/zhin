import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runConsoleInit, type ConsoleAdmin, type ConsoleCliIo, type ConsoleInitOptions } from '../src/commands/console.js';
import { setupOnboardingDeps } from '../src/commands/setup-onboarding.js';

const OWNER_PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zci-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  return root;
}

function cliIo(stdin: string): ConsoleCliIo & { logs: string[]; errors: string[]; reads: number } {
  const io = {
    logs: [] as string[],
    errors: [] as string[],
    reads: 0,
    log: (message: string) => { io.logs.push(message); },
    error: (message: string) => { io.errors.push(message); },
    readStdin: async () => { io.reads += 1; return stdin; },
    prompt: async () => { throw new Error('unexpected prompt'); },
    hostRunning: async () => false,
  };
  return io as never;
}

/** A fake project admin that records what `zhin console init` sends to the setup service. */
function fakeAdmin() {
  const tested: Array<{ dialect: string; connection: Record<string, unknown> }> = [];
  const owners: Array<{ username: unknown; password: unknown }> = [];
  let owner = false;
  const admin = {
    via: 'database',
    users: undefined,
    status: async () => ({ setupRequired: !owner, database: { dialect: 'sqlite', source: 'default' } }),
    drivers: async () => [],
    testDatabase: async (input: { dialect: string; connection: Record<string, unknown> }) => {
      tested.push(input);
      return { ok: true };
    },
    applyDatabase: async () => ({ notice: '', switched: true }),
    createOwner: async (input: { username: unknown; password: unknown }) => {
      owners.push(input);
      owner = true;
      return { user: { username: input.username } };
    },
    close: async () => undefined,
  } as unknown as ConsoleAdmin;
  return { admin, tested, owners, open: async () => admin };
}

async function init(options: ConsoleInitOptions, stdin = '') {
  const root = await project();
  const fake = fakeAdmin();
  const io = cliIo(stdin);
  vi.spyOn(setupOnboardingDeps, 'createService').mockReturnValue({} as never);
  vi.spyOn(setupOnboardingDeps.io, 'log').mockImplementation(() => {});
  vi.spyOn(setupOnboardingDeps.io, 'error').mockImplementation(() => {});
  const code = await runConsoleInit(root, options, io, fake.open);
  return { code, io, ...fake };
}

describe('zhin console init database password', () => {
  it('reads the database password from the first stdin line and the owner password from the second', async () => {
    const { code, io, tested, owners } = await init({
      database: 'pg',
      connection: { host: 'db', user: 'zhin', database: 'zhin' },
      databasePasswordStdin: true,
      owner: 'alice',
      passwordStdin: true,
      yes: true,
    }, `db-secret\n${OWNER_PASSWORD}\n`);

    expect(code).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.reads).toBe(1);
    expect(tested[0]).toEqual({ dialect: 'pg', connection: { host: 'db', user: 'zhin', database: 'zhin', password: 'db-secret' } });
    expect(owners[0]).toMatchObject({ username: 'alice', password: OWNER_PASSWORD });
  });

  it('keeps reading the owner password from the first line without --database-password-stdin', async () => {
    const { code, owners, tested } = await init({
      database: 'pg',
      connection: { host: 'db' },
      passwordEnv: 'PG_PASSWORD',
      owner: 'alice',
      passwordStdin: true,
      yes: true,
    }, `${OWNER_PASSWORD}\n`);

    expect(code).toBe(0);
    expect(tested[0]?.connection).toEqual({ host: 'db', password: '${PG_PASSWORD}' });
    expect(owners[0]).toMatchObject({ password: OWNER_PASSWORD });
  });

  it('still accepts --database-password but warns that it is not recommended', async () => {
    const { code, io, tested } = await init({
      database: 'pg',
      connection: { host: 'db', password: 'on-the-command-line' },
      owner: 'alice',
      passwordStdin: true,
      yes: true,
    }, `${OWNER_PASSWORD}\n`);

    expect(code).toBe(0);
    expect(tested[0]?.connection.password).toBe('on-the-command-line');
    expect(io.errors.join('\n')).toContain('不推荐');
    expect(io.errors.join('\n')).toContain('--database-password-stdin');
  });

  it('refuses more than one database password source', async () => {
    const { code, io, tested } = await init({
      database: 'pg',
      connection: { password: 'x' },
      passwordEnv: 'PG_PASSWORD',
      owner: 'alice',
      passwordStdin: true,
      yes: true,
    }, `${OWNER_PASSWORD}\n`);
    expect(code).toBe(1);
    expect(io.errors[0]).toContain('只能选一个');
    expect(tested).toEqual([]);

    const both = await init({ database: 'pg', passwordEnv: 'PG_PASSWORD', databasePasswordStdin: true, yes: true }, 'x\n');
    expect(both.code).toBe(1);
    expect(both.io.reads).toBe(0);
  });

  it('refuses a database password without --database and an empty stdin line', async () => {
    const orphan = await init({ databasePasswordStdin: true, owner: 'alice', passwordStdin: true, yes: true }, 'x\ny\n');
    expect(orphan.code).toBe(1);
    expect(orphan.io.errors[0]).toContain('--database');

    const empty = await init({ database: 'pg', databasePasswordStdin: true, owner: 'alice', passwordStdin: true, yes: true }, `\n${OWNER_PASSWORD}\n`);
    expect(empty.code).toBe(1);
    expect(empty.io.errors[0]).toContain('第一行为空');
    expect(empty.tested).toEqual([]);
  });
});
