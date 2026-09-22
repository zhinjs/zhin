import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { ImRuntime } from '@zhin.js/core/runtime';
import { createConsoleEventHub, createHttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { startConsoleControlPlane } from '../../../src/plugin-runtime/console/api-installer.js';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { createPluginLifecycleStore } from '../../../src/plugin-runtime/plugin-lifecycle-store.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('process Console control plane', () => {
  it('serves login assistance before the first Runtime generation commits', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-console-bootstrap-'));
    cleanups.push(() => rm(projectRoot, { recursive: true, force: true }));
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 'bootstrap-test' }));

    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    cleanups.push(() => http.close());
    const im = new ImRuntime();
    const hub = createConsoleEventHub();
    const pluginLifecycleStore = createPluginLifecycleStore();
    cleanups.push(() => pluginLifecycleStore.dispose());
    const dispose = startConsoleControlPlane({
      http,
      console: {
        runView: async () => {
          throw new Error('ConsoleRuntime has no committed generation');
        },
      } as unknown as ConsoleRuntime,
      projectRoot,
      im,
      eventHub: hub,
      pluginLifecycleStore,
      configuration: new ConsoleConfigurationStore({
        projectRoot,
        document: createConfigDocument(join(projectRoot, 'zhin.config.yml')),
      }),
    });
    cleanups.push(dispose);
    const { port } = await http.listen();

    const events = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(events.status).toBe(200);
    cleanups.push(() => events.body?.cancel());
    for (let attempt = 0; attempt < 50 && hub.subscriberCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(hub.subscriberCount).toBe(1);

    const owner = {};
    const waiting = im.loginAssist.waitForInput(
      'icqq',
      '10001',
      'qrcode',
      { message: 'scan', image: 'data:image/png;base64,dGVzdA==' },
      { owner, timeoutMs: 0 },
    );
    const task = im.loginAssist.listPending()[0]!;
    const historyResponse = await fetch(
      `http://127.0.0.1:${port}/api/events/history?after=0&limit=10`,
    );
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as {
      data: { items: Array<{ type: string; data: { id: string } }> };
    };
    expect(history.data.items).toContainEqual(expect.objectContaining({
      type: 'endpoint.login.pending',
      data: expect.objectContaining({ id: task.id }),
    }));

    const list = await consoleRpc(port, { type: 'login.list', requestId: 1 });
    expect(list).toMatchObject({
      success: true,
      data: {
        count: 1,
        tasks: [{ id: task.id, adapter: 'icqq', endpointKey: '10001', type: 'qrcode' }],
      },
    });

    const submit = await consoleRpc(port, {
      type: 'login.submit',
      requestId: 2,
      taskId: task.id,
      value: 'ok',
    });
    expect(submit).toMatchObject({ success: true, data: { success: true } });
    await expect(waiting).resolves.toBe('ok');
  });
});

async function consoleRpc(port: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}
