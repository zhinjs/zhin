import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import {
  createNativeTodoToolFeatures,
  FileTodoStore,
} from '../../src/plugin-runtime/native-todo-tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('native TODO ToolFeatures', () => {
  it('isolates plans by canonical session identity without accepting a chat/path selector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-todos-'));
    roots.push(root);
    const features = createNativeTodoToolFeatures(new FileTodoStore(root));
    const write = features.find((tool) => tool.name === 'todo_write')!.definition;
    const read = features.find((tool) => tool.name === 'todo_read')!.definition;
    const first = context('im:bot:group:first');
    const second = context('im:bot:group:second');

    await write.execute({
      items: [{ title: 'First task', status: 'in-progress' }],
      chat_id: '../../second',
    }, first);

    await expect(read.execute({}, first)).resolves.toContain('First task');
    await expect(read.execute({}, second)).resolves.toContain('No tasks found');
    expect(await readdir(root)).toHaveLength(1);
  });

  it('serializes replacements and publishes only complete documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-todos-'));
    roots.push(root);
    const store = new FileTodoStore(root);
    const features = createNativeTodoToolFeatures(store);
    const write = features.find((tool) => tool.name === 'todo_write')!.definition;
    const read = features.find((tool) => tool.name === 'todo_read')!.definition;
    const ctx = context('session');

    const first = write.execute({ items: [{ title: 'old', status: 'pending' }] }, ctx);
    const second = write.execute({ items: [{ title: 'new', status: 'done' }] }, ctx);
    await Promise.all([first, second]);

    await expect(read.execute({}, ctx)).resolves.toContain('new');
    await expect(read.execute({}, ctx)).resolves.not.toContain('old');
    expect((await readdir(root)).every((name) => name.endsWith('.json'))).toBe(true);
  });

  it('does not publish an aborted replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-todos-'));
    roots.push(root);
    const controller = new AbortController();
    controller.abort('turn ended');
    const store = new FileTodoStore(root);

    await expect(store.replace('session', [{ title: 'unsafe', status: 'pending' }], controller.signal))
      .rejects.toBe('turn ended');
    await expect(store.read('session', new AbortController().signal)).resolves.toEqual([]);
  });
});

function context(sessionKey: string): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey,
    origin: { kind: 'http', sessionId: sessionKey },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
  } as ToolExecutionContext;
}
