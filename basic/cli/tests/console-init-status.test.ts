import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSetupStatus, runConsoleInit, type ConsoleAdmin, type ConsoleCliIo } from '../src/commands/console.js';
import { setupOnboardingDeps } from '../src/commands/setup-onboarding.js';

const OWNER_PASSWORD = 'correct-horse-battery';
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'zcis-'));
  dirs.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: {} }));
  await writeFile(path.join(root, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
  return root;
}

function cliIo(stdin = '', hostRunning = false): ConsoleCliIo & { logs: string[]; errors: string[] } {
  const io = {
    logs: [] as string[],
    errors: [] as string[],
    log: (message: string) => { io.logs.push(message); },
    error: (message: string) => { io.errors.push(message); },
    readStdin: async () => stdin,
    prompt: async () => { throw new Error('unexpected prompt'); },
    hostRunning: async () => hostRunning,
  };
  return io as never;
}

function fakeAdmin(applied: { notice: string; switched: boolean; changed?: boolean }) {
  let owner = false;
  let opened = 0;
  const admin = {
    via: 'database',
    users: undefined,
    status: async () => ({ setupRequired: !owner, database: { dialect: 'sqlite', source: 'default', summary: { filename: '.zhin/data.sqlite' } } }),
    drivers: async () => [],
    testDatabase: async () => ({ ok: true }),
    applyDatabase: vi.fn(async () => applied),
    createOwner: async (input: { username: unknown }) => { owner = true; return { user: { username: input.username } }; },
    close: async () => undefined,
  } as unknown as ConsoleAdmin;
  return { admin, open: async () => { opened += 1; return admin; }, opened: () => opened };
}

function quietOnboarding(): void {
  vi.spyOn(setupOnboardingDeps, 'createService').mockReturnValue({} as never);
  vi.spyOn(setupOnboardingDeps.io, 'log').mockImplementation(() => {});
  vi.spyOn(setupOnboardingDeps.io, 'error').mockImplementation(() => {});
}

describe('zhin console init --status (#1250 console-init-status-json)', () => {
  it('prints a readable summary by default and JSON only with --json', async () => {
    const root = await project();
    const fake = fakeAdmin({ notice: '', switched: false });
    const readable = cliIo();
    expect(await runConsoleInit(root, { status: true }, readable, fake.open)).toBe(0);
    expect(readable.logs).toEqual([
      'Console 尚未初始化：还没有所有者账号。',
      '数据库：sqlite（默认，filename .zhin/data.sqlite）',
      '运行 zhin console init 创建所有者，或打开 zhin start 打印的 Console 链接完成初始化。',
    ]);
    const json = cliIo();
    expect(await runConsoleInit(root, { status: true, json: true }, json, fake.open)).toBe(0);
    expect(JSON.parse(json.logs[0]!)).toMatchObject({ setupRequired: true, database: { dialect: 'sqlite', source: 'default' } });
  });

  it('refuses --json without --status before opening anything', async () => {
    const root = await project();
    const fake = fakeAdmin({ notice: '', switched: false });
    const io = cliIo();
    expect(await runConsoleInit(root, { json: true }, io, fake.open)).toBe(1);
    expect(io.errors).toEqual(['--json 只能与 --status 一起使用']);
    expect(fake.opened()).toBe(0);
  });

  it('describes an initialised Console', () => {
    expect(renderSetupStatus({ setupRequired: false, database: { dialect: 'pg', source: 'config', summary: { host: 'db', port: 5432 } } }))
      .toEqual(['Console 已初始化：已有所有者账号。', '数据库：pg（配置文件，host db，port 5432）', '管理用户：zhin console user list / create / passwd']);
  });
});

describe('zhin console init with the database in use (#1250 console-init-default-db-restart)', () => {
  it('says nothing changed, does not reopen and does not ask for a restart', async () => {
    quietOnboarding();
    const root = await project();
    const fake = fakeAdmin({ notice: '', switched: false, changed: false });
    const io = cliIo(`${OWNER_PASSWORD}\n`, true);
    expect(await runConsoleInit(root, { database: 'sqlite', owner: 'alice', passwordStdin: true, yes: true }, io, fake.open)).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.logs).toContain('数据库保持当前设置（sqlite），未改动配置，无需重启。');
    expect(io.logs.join('\n')).not.toMatch(/已写入数据库配置|切换数据库不会迁移|请重启/u);
    expect(fake.opened()).toBe(1);
  });

  it('still reports a real change and the restart hint', async () => {
    quietOnboarding();
    const root = await project();
    const fake = fakeAdmin({ notice: '切换数据库不会迁移旧库数据：插件数据仍留在原数据库。', switched: false, changed: true });
    const io = cliIo(`${OWNER_PASSWORD}\n`, true);
    expect(await runConsoleInit(root, { database: 'sqlite', connection: { filename: 'data/x.sqlite' }, owner: 'alice', passwordStdin: true, yes: true }, io, fake.open)).toBe(0);
    expect(io.logs).toContain('已写入数据库配置。切换数据库不会迁移旧库数据：插件数据仍留在原数据库。');
    expect(io.logs).toContain('检测到 Host 正在运行：请重启它以使用新的数据库。');
    expect(fake.opened()).toBe(2);
  });
});
