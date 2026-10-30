import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { registerAgentConsoleRoutes } from '../../../src/plugin-runtime/console/agent-routes.js';

const state = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock('../../../src/plugin-runtime/console/agent-console.js', () => ({
  withGenerationAgentConsole: async (_snapshots: unknown, visit: (value: unknown) => Promise<void>) => {
    await visit({ trace: { list: () => ({ sessionKey: 'sandbox:bot:private:owner', events: state.events,
      latestSequence: state.events.length, activeTurnIds: [] }) } });
    return true;
  },
}));

let directory: string;
const hosts: HttpHost[] = [];
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'zhin-trace-file-ref-')));
  await mkdir(join(directory, 'project', 'src'), { recursive: true });
  state.events = [];
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  await rm(directory, { recursive: true, force: true });
});

const event = (path: string, overrides: Record<string, unknown> = {}) => ({
  type: 'tool_result', data: { toolName: 'write_file', toolUseId: 'write', fileChange: { path }, output: 'unchanged' }, ...overrides,
});

async function start(projectRoot: string | undefined) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  hosts.push(http);
  registerAgentConsoleRoutes({ http, base: '/api', projectRoot });
  const { port } = await http.listen();
  return (token = 'operator') => fetch(`http://127.0.0.1:${port}/api/agent/traces?sessionKey=sandbox:bot:private:owner`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

it('projects successful canonical tool evidence into a project-relative file without rewriting the original event', async () => {
  const path = join(directory, 'project', 'src', 'result.txt');
  await writeFile(path, 'result');
  state.events = [event(path), event(path, { sequence: 2 })];
  const request = await start(join(directory, 'project'));
  const response = await request();
  expect(response.status).toBe(200);
  const { data } = await response.json();
  for (const item of data.events) expect(item.data).toMatchObject({ projectFile: { path: 'src/result.txt' }, output: 'unchanged', fileChange: { path } });
  expect(state.events[0]).not.toHaveProperty('data.projectFile');
});

it('uses the actual Host project root and resolves symlinks without admitting outside or blocked paths', async () => {
  const project = join(directory, 'project');
  const inside = join(project, 'src', 'inside.txt'), outside = join(directory, 'outside.txt');
  await writeFile(inside, 'inside'); await writeFile(outside, 'outside');
  await mkdir(join(project, 'data'));
  await writeFile(join(project, 'data', 'private.txt'), 'private');
  await symlink(inside, join(project, 'src', 'in-link.txt'));
  await symlink(outside, join(project, 'src', 'out-link.txt'));
  const alias = join(directory, 'project-alias'); await symlink(project, alias);
  state.events = [event(join(project, 'src', 'in-link.txt')), event(join(project, 'src', 'out-link.txt')),
    event(outside), event(join(project, 'data', 'private.txt')), event(join(project, 'src', 'missing.txt'))];
  const { data } = await (await (await start(alias))()).json();
  expect(data.events[0].data.projectFile).toEqual({ path: 'src/inside.txt' });
  for (const item of data.events.slice(1)) expect(item.data).not.toHaveProperty('projectFile');
});

it('never guesses a reference from model arguments, relative evidence, failed tools or truncated identifiers', async () => {
  const path = join(directory, 'project', 'src', 'existing.txt'); await writeFile(path, 'text');
  const clipped = join(directory, 'project', 'src', 'name… [truncated]'); await writeFile(clipped, 'different file');
  state.events = [
    { type: 'tool_call', data: { toolName: 'write_file', args: { file_path: path } } },
    { type: 'tool_result', data: { toolName: 'write_file', output: `Wrote ${path}` } },
    event('src/existing.txt'), event(path, { type: 'tool_failed' }), event(clipped),
    { type: 'tool_result', data: { toolName: 'lookup', fileChange: { path } } },
  ];
  const { data } = await (await (await start(join(directory, 'project')))()).json();
  for (const item of data.events) expect(item.data).not.toHaveProperty('projectFile');
});

it('leaves traces readable when the project root is unavailable and denies Demo before any projection', async () => {
  const path = join(directory, 'project', 'src', 'result.txt'); await writeFile(path, 'result');
  state.events = [event(path)];
  for (const root of [undefined, join(directory, 'missing-project')]) {
    const request = await start(root);
    expect((await request('demo')).status).toBe(403);
    const { data } = await (await request()).json();
    expect(data.events).toEqual(state.events);
  }
});
