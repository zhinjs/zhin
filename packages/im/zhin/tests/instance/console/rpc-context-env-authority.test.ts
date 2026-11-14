import { CONSOLE_PERMISSIONS } from '@zhin.js/console-protocol';
import { ConsoleRpcRequestScope, environmentWriteAllowed } from '../../../src/instance/console/rpc-context.js';
import type { ConsoleRpcComposition } from '../../../src/instance/console/rpc-composition.js';

/**
 * #1250 security review: a Console config write may move secret literals into `.env` only for a
 * principal that may write `.env` itself (`ops.env.write`, or unrestricted owner access).
 */
const access = (permissions: string[], unrestricted = false) => ({ unrestricted, permissions, roles: [] });

it('grants .env authority only with ops.env.write or unrestricted access', () => {
  expect(environmentWriteAllowed(undefined)).toBe(false);
  expect(environmentWriteAllowed(access([CONSOLE_PERMISSIONS.OPS_CONFIG_WRITE]))).toBe(false);
  expect(environmentWriteAllowed(access([CONSOLE_PERMISSIONS.OPS_CONFIG_WRITE, CONSOLE_PERMISSIONS.OPS_ENV_WRITE]))).toBe(true);
  expect(environmentWriteAllowed(access([], true))).toBe(true);
});

it('passes the caller authority to config:set, config:patch and config:patch-project', async () => {
  const calls: Array<[string, unknown]> = [];
  const configuration = {
    setKey: async (_name: string, _data: unknown, authority?: unknown) => { calls.push(['setKey', authority]); return { restartRequired: false }; },
    patch: async (_request: unknown, authority?: unknown) => { calls.push(['patch', authority]); return { status: 'saved' }; },
    patchProject: async (_request: unknown, authority?: unknown) => { calls.push(['patchProject', authority]); return { status: 'saved' }; },
  };
  const composition = { configuration } as unknown as ConsoleRpcComposition;
  const run = async (permissions: string[]) => {
    const scope = new ConsoleRpcRequestScope(composition, { authScope: 'full', access: access(permissions) });
    await scope.context.setConfigKey!('http', {});
    await scope.context.patchConfig!({ expectedRevision: 'r', patches: [] });
    await scope.context.patchProjectConfig!({ expectedRevision: 'r', patches: [] });
    scope.close();
  };
  await run([CONSOLE_PERMISSIONS.OPS_CONFIG_WRITE]);
  expect(calls.map(([, authority]) => authority)).toEqual([{ environmentWrite: false }, { environmentWrite: false }, { environmentWrite: false }]);
  calls.length = 0;
  await run([CONSOLE_PERMISSIONS.OPS_CONFIG_WRITE, CONSOLE_PERMISSIONS.OPS_ENV_WRITE]);
  expect(calls.map(([name, authority]) => [name, authority])).toEqual([
    ['setKey', { environmentWrite: true }], ['patch', { environmentWrite: true }], ['patchProject', { environmentWrite: true }],
  ]);
});
