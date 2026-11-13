import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument, createPluginLifecycleStore } from '@zhin.js/runtime';
import { ImRuntime } from '@zhin.js/core/runtime';
import { createConsoleEventHub, type ConsoleAccessProvider, type ConsoleAuditEntry, type ConsoleUserPrincipal } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import { CONSOLE_BUILTIN_ROLES } from '@zhin.js/console-protocol';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { startConsoleControlPlane } from '../../../src/instance/console/api-installer.js';
import { ConsoleConfigurationStore } from '../../../../../host/gateway/src/config/configuration.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function operatorProvider(audits: ConsoleAuditEntry[]): ConsoleAccessProvider {
  const operator: ConsoleUserPrincipal = {
    kind: 'user', userId: 'op', username: 'op', displayName: 'op', credentialId: 'op-session',
    grants: [{ role: 'operator', scope: { kind: 'global' }, permissions: CONSOLE_BUILTIN_ROLES.operator.permissions }],
    roles: ['operator'],
  };
  return {
    initialized: () => true,
    authenticate: async token => (token === 'op-session' ? operator : null),
    audit: entry => { audits.push(entry); },
  };
}

describe('login flow Console RPCs (ADR 0058)', () => {
  it('audits submit / relogin with actor, endpoint, action and result but never values', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-login-flow-'));
    cleanups.push(() => rm(projectRoot, { recursive: true, force: true }));
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 'login-flow-test' }));
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    cleanups.push(() => http.close());
    const audits: ConsoleAuditEntry[] = [];
    cleanups.push(http.tokenRegistry.useAccessProvider(operatorProvider(audits)));
    const im = new ImRuntime();
    const pluginLifecycleStore = createPluginLifecycleStore(projectRoot);
    cleanups.push(() => pluginLifecycleStore.dispose());
    cleanups.push(startConsoleControlPlane({
      http,
      console: { runView: async () => { throw new Error('no generation'); } } as unknown as ConsoleRuntime,
      projectRoot,
      im,
      eventHub: createConsoleEventHub(),
      pluginLifecycleStore,
      configuration: new ConsoleConfigurationStore({ projectRoot, document: createConfigDocument(join(projectRoot, 'zhin.config.yml')) }),
    }));
    const { port } = await http.listen();
    const rpc = async (body: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer op-session' },
        body: JSON.stringify(body),
      });
      return response.json() as Promise<Record<string, unknown>>;
    };

    const flow = im.loginAssist.beginFlow({ adapter: 'icqq', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({ kind: 'device', title: '设备锁', input: { kind: 'code', label: '验证码', secret: true } });
    void answer.then(() => flow.outcome({ result: 'rejected', code: 'code_invalid', next: 'retry_input' }));
    const taskId = im.loginAssist.listPending()[0]!.id;

    const submitted = await rpc({
      type: 'login.submit', requestId: 1, taskId, adapter: 'icqq', endpointKey: 'bot1',
      value: { action: 'submit', values: { input: '987654' } }, wait: true,
    });
    expect(submitted).toMatchObject({ success: true, data: { accepted: true, outcome: { result: 'rejected', code: 'code_invalid' } } });

    const relogin = await rpc({ type: 'login.relogin', requestId: 2, adapter: 'icqq', endpointKey: 'bot1' });
    expect(relogin).toMatchObject({ success: false });

    const flows = await rpc({ type: 'login.flow.list', requestId: 3 });
    expect(flows).toMatchObject({ success: true, data: { count: 1 } });

    const login = audits.filter(entry => entry.action.startsWith('rpc:login.'));
    expect(login).toEqual([
      expect.objectContaining({
        actor: 'user:op', action: 'rpc:login.submit', target: 'endpoint:icqq/bot1', outcome: 'ok',
        detail: expect.objectContaining({ result: 'rejected', code: 'code_invalid' }),
      }),
      expect.objectContaining({ action: 'rpc:login.relogin', target: 'endpoint:icqq/bot1', outcome: 'error' }),
    ]);
    expect(JSON.stringify(audits)).not.toContain('987654');
  });
});
