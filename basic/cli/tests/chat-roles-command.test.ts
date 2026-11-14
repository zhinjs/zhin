import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultChatRolesExportPath, exportChatRoles, importChatRoles } from '../src/commands/chat-roles.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

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
});
