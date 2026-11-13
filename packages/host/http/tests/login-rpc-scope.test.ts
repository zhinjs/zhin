import { describe, expect, it } from 'vitest';
import { authorizeConsoleRpc, type ConsoleUserPrincipal } from '../src/access-control.js';
import { dispatchRuntimeConsoleRpc } from '../src/console-rpc.js';

const { LoginAssist } = await import('../../../im/core/src/built/login-assist.js');

function principal(scope: ConsoleUserPrincipal['grants'][number]['scope'], permissions = ['endpoint.view', 'endpoint.operate']): ConsoleUserPrincipal {
  return Object.freeze({
    kind: 'user', userId: 's', username: 's', displayName: 's', credentialId: 's-session', roles: ['op'],
    grants: [{ role: 'op', scope, permissions }],
  }) as ConsoleUserPrincipal;
}

const ENDPOINT_SCOPED = principal({ kind: 'endpoint', key: 'qq/mine' });
const ADAPTER_SCOPED = principal({ kind: 'adapter', key: 'qq' });
const GLOBAL = principal({ kind: 'global' });

const SECRET = 'SECRET-DEVICE-JSON';

function setup() {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
  const victim = assist.beginFlow({ adapter: 'qq', endpointKey: 'victim', owner: {} });
  const victimAnswer = victim.challenge({
    kind: 'device', title: 'device',
    blocks: [{ kind: 'copy', id: 'dev', label: 'dev', content: SECRET, format: 'json', sensitive: true }],
    input: { kind: 'code', label: 'code' },
  });
  victimAnswer.catch(() => undefined);
  const victimTask = assist.listPending()[0]!.id;
  const mine = assist.beginFlow({ adapter: 'qq', endpointKey: 'mine', owner: {} });
  mine.challenge({ kind: 'sms', title: 'sms', input: { kind: 'code', label: 'code' } }).catch(() => undefined);
  const mineTask = assist.listPending().find(task => task.endpointKey === 'mine')!.id;
  return { assist, victim, victimAnswer, victimTask, mine, mineTask };
}

async function rpc(
  message: Record<string, unknown>,
  assist: InstanceType<typeof LoginAssist>,
  who: ConsoleUserPrincipal | undefined,
) {
  const replies = await dispatchRuntimeConsoleRpc({ requestId: 1, ...message } as never, {
    authScope: 'full',
    ...(who ? { principal: who } : {}),
    listPages: async () => [],
    extended: { projectRoot: '/tmp', loginAssist: assist as never },
  } as never);
  return replies[replies.length - 1]!;
}

describe('login RPCs honour the authorized Endpoint scope (B-1 / B-2)', () => {
  for (const [label, scoped] of [['endpoint-scoped', ENDPOINT_SCOPED], ['adapter-scoped', ADAPTER_SCOPED]] as const) {
    describe(label, () => {
      it('cannot answer or cancel another Endpoint\'s challenge by naming its own Endpoint in data', async () => {
        const { assist, victimTask } = setup();
        for (const type of ['login.submit', 'login.cancel']) {
          const message = { type, taskId: victimTask, value: '123456', data: { adapter: 'qq', endpointKey: 'mine' } };
          // The reviewer's PoC: authz admits it through the data target …
          expect(authorizeConsoleRpc(scoped, message).allowed).toBe(true);
          // … and the handler now keeps the task inside that target.
          const reply = await rpc(message, assist, scoped);
          expect(reply.error).toBe(`login task not found: ${victimTask}`);
        }
        expect(assist.listPending().some(task => task.id === victimTask)).toBe(true);
        assist.dispose();
      });

      it('answers its own Endpoint\'s challenge through data or top level', async () => {
        const { assist, mineTask } = setup();
        const reply = await rpc({ type: 'login.submit', taskId: mineTask, value: '1', data: { adapter: 'qq', endpointKey: 'mine' } }, assist, scoped);
        expect(reply.data).toEqual({ success: true });
        assist.dispose();
      });

      it('rejects a mismatch between data and the top-level target', async () => {
        const { assist, victimTask } = setup();
        const reply = await rpc({
          type: 'login.submit', taskId: victimTask, value: '1', adapter: 'qq', endpointKey: 'victim', data: { adapter: 'qq', endpointKey: 'mine' },
        }, assist, scoped);
        expect(reply.error).toBeTruthy();
        expect(assist.listPending().some(task => task.id === victimTask)).toBe(true);
        assist.dispose();
      });

      it('login.flow.list / login.flow.get / login.list only show its own Endpoint', async () => {
        const { assist, victim } = setup();
        for (const where of ['data', 'top'] as const) {
          const target = { adapter: 'qq', endpointKey: 'mine' };
          const wrap = (type: string, extra: Record<string, unknown> = {}) => (where === 'data'
            ? { type, ...extra, data: target } : { type, ...extra, ...target });
          const flows = await rpc(wrap('login.flow.list'), assist, scoped);
          expect(JSON.stringify(flows)).not.toContain(SECRET);
          expect((flows.data as { flows: { endpointKey: string }[] }).flows.map(flow => flow.endpointKey)).toEqual(['mine']);
          const byId = await rpc(wrap('login.flow.get', { flowId: victim.id }), assist, scoped);
          expect(byId.data).toEqual({ flow: null });
          const pending = await rpc(wrap('login.list'), assist, scoped);
          expect(JSON.stringify(pending)).not.toContain('victim');
          expect((pending.data as { count: number }).count).toBe(1);
        }
        assist.dispose();
      });

      it('cannot reach another Endpoint by naming it in data only', async () => {
        const { assist } = setup();
        const reply = await rpc({ type: 'login.flow.list', data: { adapter: 'qq', endpointKey: 'victim' } }, assist, ENDPOINT_SCOPED);
        expect(reply.error).toBeTruthy();
        assist.dispose();
      });
    });
  }

  it('global grants and in-process callers are unaffected', async () => {
    for (const who of [GLOBAL, undefined]) {
      const { assist, victimTask, victimAnswer } = setup();
      const flows = await rpc({ type: 'login.flow.list' }, assist, who);
      expect((flows.data as { count: number }).count).toBe(2);
      const pending = await rpc({ type: 'login.list' }, assist, who);
      expect((pending.data as { count: number }).count).toBe(2);
      const reply = await rpc({ type: 'login.submit', taskId: victimTask, value: '123456' }, assist, who);
      expect(reply.data).toEqual({ success: true });
      await expect(victimAnswer).resolves.toMatchObject({ values: { input: '123456' } });
      assist.dispose();
    }
  });
});
