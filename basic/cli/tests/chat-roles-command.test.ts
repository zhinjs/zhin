import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatRolesCommand, chatRolesExportLines, chatRolesImportLines, defaultChatRolesExportPath, exportChatRoles, importChatRoles,
} from '../src/commands/chat-roles.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

// `zhin chat-roles` only talks to this project's gateway (#1250): a stand-in whose local-socket
// fetch delegates to the stubbed global fetch while `gateway.running` is set.
const gateway = vi.hoisted(() => ({ running: false }));
vi.mock('@zhin.js/gateway/local', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zhin.js/gateway/local')>(),
  probeLocalGateway: async () => (gateway.running ? { ok: true } : undefined),
  createLocalGatewayFetch: () => ((url: unknown, init?: RequestInit) => globalThis.fetch(url as string, init)),
}));

const dirs: string[] = [];
afterEach(async () => {
  gateway.running = false;
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const sample = { format: 'zhin.chat-roles', version: 1, exportedAt: 1, principals: [], identities: [], roles: [], consoleLinks: [] };

function host(reply: (body: any) => { status: number; body: unknown }) {
  const calls: any[] = [];
  const http: HostHttpConfig = {
    baseUrl: 'http://127.0.0.1:1/api', token: '',
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const answer = reply(body);
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }) as never,
  };
  return { http, calls };
}

describe('zhin chat-roles export|import (ADR 0060 §4.5)', () => {
  it('exports through the Console RPC to a 0600 file under .zhin/backups by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-chat-roles-'));
    dirs.push(root);
    const file = defaultChatRolesExportPath(root, new Date('2026-11-14T00:00:00Z'));
    expect(file).toBe(join(root, '.zhin', 'backups', 'chat-roles-2026-11-14T00-00-00-000Z.json'));
    const { http, calls } = host(() => ({ status: 200, body: { success: true, data: sample } }));
    const result = await exportChatRoles(http, file);
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:1/api/console/request', body: { type: 'chat-principals.export' } });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(sample);
  });

  it('imports only zhin.chat-roles files and reports a refused RPC (no global iam.manage)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-chat-roles-'));
    dirs.push(root);
    const bad = join(root, 'bad.json');
    await writeFile(bad, JSON.stringify({ roles: [] }));
    const { http, calls } = host(() => ({ status: 403, body: { success: false, error: '导入聊天角色需要全局 iam.manage 权限' } }));
    expect(await importChatRoles(http, bad)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    const good = join(root, 'good.json');
    await writeFile(good, JSON.stringify(sample));
    expect(await importChatRoles(http, good)).toEqual({ ok: false, error: '导入聊天角色需要全局 iam.manage 权限' });
    expect(calls[0].body).toMatchObject({ type: 'chat-principals.import', data: { data: sample } });
  });

  it('formats the export / import results as stdout lines, skipped entries included', () => {
    expect(chatRolesExportLines({ ...sample, principals: [{}, {}], identities: [{}, {}, {}], roles: [{}], consoleLinks: [{}] } as never, '/tmp/out.json'))
      .toEqual(['✓ 已导出 2 个人、3 条聊天身份、1 条角色授予、1 条 Console 链接到 /tmp/out.json']);
    expect(chatRolesExportLines({ ...sample, principals: [], identities: [], roles: [], consoleLinks: [] } as never, '/tmp/empty.json'))
      .toEqual(['✓ 已导出 0 个人、0 条聊天身份、0 条角色授予、0 条 Console 链接到 /tmp/empty.json']);
    expect(chatRolesImportLines({ principals: 1, identities: 2, roles: 3, consoleLinks: 0, skipped: ['qq:42 已属于另一个人'] }))
      .toEqual(['✓ 已导入：新人 1、身份 2、角色 3、Console 链接 0', '跳过：qq:42 已属于另一个人']);
  });

  it('writes the import result to stdout (output.line), not through the logger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-chat-roles-'));
    dirs.push(root);
    const file = join(root, 'good.json');
    await writeFile(file, JSON.stringify(sample));
    await writeFile(join(root, 'zhin.config.yml'), 'http:\n  port: 1\n');
    const imported = { principals: 1, identities: 1, roles: 1, consoleLinks: 0, skipped: ['坏行'] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: imported }), { status: 200 })));
    const stdout: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { stdout.push(String(line)); });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    gateway.running = true;
    try {
      await chatRolesCommand.parseAsync(['import', file], { from: 'user' });
    } finally {
      cwd.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(stdout).toEqual(['✓ 已导入：新人 1、身份 1、角色 1、Console 链接 0\n跳过：坏行']);
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).not.toContain('已导入');
  });

  it('refuses without this project\'s running gateway: reports it and sends nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-chat-roles-'));
    dirs.push(root);
    const file = join(root, 'good.json');
    await writeFile(file, JSON.stringify(sample));
    await writeFile(join(root, 'zhin.config.yml'), 'http:\n  port: 1\n');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      await expect(chatRolesCommand.parseAsync(['import', file], { from: 'user' })).rejects.toThrow('exit 1');
    } finally {
      cwd.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(exit).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('export / import accept --host and refuse an unverified local target unless --allow-unverified-host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-cli-chat-roles-'));
    dirs.push(root);
    await writeFile(join(root, 'zhin.config.yml'), 'http:\n  port: 1\n');
    const file = join(root, 'good.json');
    await writeFile(file, JSON.stringify(sample));
    for (const sub of ['export', 'import']) {
      const command = chatRolesCommand.commands.find(c => c.name() === sub)!;
      expect(command.options.map(option => option.long)).toEqual(expect.arrayContaining(['--host', '--allow-unverified-host']));
    }
    const urls: string[] = [];
    const imported = { principals: 0, identities: 0, roles: 0, consoleLinks: 0, skipped: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      // A /pub/health that reports no project id: unverified.
      return new Response(JSON.stringify(url.endsWith('/pub/health') ? { status: 'ok' } : { success: true, data: imported }), { status: 200 });
    }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      await expect(chatRolesCommand.parseAsync(['import', file, '--host', 'http://127.0.0.1:9'], { from: 'user' })).rejects.toThrow('exit 1');
      expect(urls).toEqual(['http://127.0.0.1:9/pub/health']);
      urls.length = 0;
      exit.mockClear();
      await chatRolesCommand.parseAsync(['import', file, '--host', 'http://127.0.0.1:9', '--allow-unverified-host'], { from: 'user' });
      expect(exit).not.toHaveBeenCalled();
      expect(urls).toEqual(['http://127.0.0.1:9/pub/health', 'http://127.0.0.1:9/api/console/request']);
    } finally {
      cwd.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
