import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_RPC_PERMISSIONS, LOGIN_RPC, resolveConsoleRpcPermission } from '@zhin.js/console-protocol';
import {
  dispatchExtendedConsoleRpc, loginAuditDetail, LOGIN_SUBMIT_WAIT_MS,
  type ConsoleEndpointLoginAccess, type ConsoleRpcExtendedCtx,
} from '../src/console-rpc-extended/index.js';

const { LoginAssist } = await import('../../../im/core/src/built/login-assist.js');

function makeCtx(overrides: Partial<ConsoleRpcExtendedCtx> = {}): ConsoleRpcExtendedCtx {
  return { fullScope: true, projectRoot: '/tmp/project', ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('login flow RPCs', () => {
  it('login.submit wait:true returns the login outcome and the flow', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner: {} });
    void flow.challenge({ kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码' } }).then(() => {
      flow.outcome({ result: 'rejected', code: 'code_invalid', next: 'retry_input' });
    });
    const taskId = assist.listPending()[0]!.id;
    const reply = await dispatchExtendedConsoleRpc('login.submit', {
      taskId, adapter: 'demo', endpointKey: 'bot1', value: { action: 'submit', values: { input: '000000' } }, wait: true,
    }, makeCtx({ loginAssist: assist }));
    expect(reply).toMatchObject({
      data: { accepted: true, outcome: { result: 'rejected', code: 'code_invalid' }, flow: { id: flow.id } },
    });
    expect(JSON.stringify(reply)).not.toContain('000000');
  });

  it('login.submit wait:true answers pending after 15 s without a result', async () => {
    vi.useFakeTimers();
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner: {} });
    void flow.challenge({ kind: 'confirm', title: '在手机上确认' });
    const reply = dispatchExtendedConsoleRpc('login.submit', {
      taskId: assist.listPending()[0]!.id, value: 'ok', wait: true,
    }, makeCtx({ loginAssist: assist }));
    await vi.advanceTimersByTimeAsync(LOGIN_SUBMIT_WAIT_MS);
    await expect(reply).resolves.toMatchObject({ data: { accepted: true, pending: true } });
    assist.dispose();
  });

  it('login.submit without wait keeps the legacy reply; invalid answers keep the challenge open', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({ kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码', pattern: '^\\d{6}$', patternHint: '6 位数字' } });
    const taskId = assist.listPending()[0]!.id;
    const ctx = makeCtx({ loginAssist: assist });
    await expect(dispatchExtendedConsoleRpc('login.submit', { taskId, value: { action: 'submit', values: { input: '12' } } }, ctx))
      .resolves.toEqual({ error: '6 位数字', data: { code: 'input_invalid' } });
    await expect(dispatchExtendedConsoleRpc('login.submit', { taskId, value: { action: 7 } }, ctx))
      .resolves.toHaveProperty('error');
    // A task of another Endpoint cannot be answered through a scoped target.
    await expect(dispatchExtendedConsoleRpc('login.submit', { taskId, adapter: 'demo', endpointKey: 'other', value: '123456' }, ctx))
      .resolves.toEqual({ error: `login task not found: ${taskId}` });
    await expect(dispatchExtendedConsoleRpc('login.submit', { taskId, value: '123456' }, ctx))
      .resolves.toEqual({ data: { success: true } });
    await expect(answer).resolves.toEqual({ actionId: 'submit', values: { input: '123456' } });
  });

  it('login.flow.list / login.flow.get return live flows', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner: {} });
    void flow.challenge({ kind: 'qrcode', title: '扫码', media: { qrImage: 'data:image/png;base64,QR' } }).catch(() => undefined);
    const ctx = makeCtx({ loginAssist: assist });
    await expect(dispatchExtendedConsoleRpc('login.flow.list', {}, ctx)).resolves.toMatchObject({ data: { count: 1, flows: [{ id: flow.id }] } });
    await expect(dispatchExtendedConsoleRpc('login.flow.list', { adapter: 'demo', endpointKey: 'x' }, ctx)).resolves.toMatchObject({ data: { count: 0 } });
    const got = await dispatchExtendedConsoleRpc('login.flow.get', { adapter: 'demo', endpointKey: 'bot1' }, ctx);
    expect(JSON.stringify(got)).toContain('data:image/png;base64,QR');
    await expect(dispatchExtendedConsoleRpc('login.flow.get', { flowId: flow.id, adapter: 'demo', endpointKey: 'other' }, ctx))
      .resolves.toEqual({ data: { flow: null } });
    await expect(dispatchExtendedConsoleRpc('login.flow.get', {}, ctx)).resolves.toHaveProperty('error');
    assist.dispose();
  });

  it('login.relogin / login.refresh answer unsupported unless declared and implemented', async () => {
    const run = (access: ConsoleEndpointLoginAccess | null) => makeCtx({
      withEndpointLogin: async (_adapter, _key, fn) => (access ? fn(access) : null),
    });
    const relogin = vi.fn(async () => {});
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, makeCtx()))
      .resolves.toMatchObject({ error: expect.stringMatching(/^unsupported:/u), data: { code: 'unsupported' } });
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, run({})))
      .resolves.toMatchObject({ data: { code: 'unsupported' } });
    // Declared without the port, or the port without the declaration: still unsupported.
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, run({ declaration: { mode: 'interactive', relogin: true } })))
      .resolves.toMatchObject({ data: { code: 'unsupported' } });
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, run({ declaration: { mode: 'interactive' }, control: { relogin } })))
      .resolves.toMatchObject({ data: { code: 'unsupported' } });
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, run({ declaration: { mode: 'interactive', relogin: true }, control: { relogin } })))
      .resolves.toEqual({ data: { accepted: true } });
    expect(relogin).toHaveBeenCalledTimes(1);
    await expect(dispatchExtendedConsoleRpc('login.refresh', { adapter: 'demo', endpointKey: 'bot1' }, run({ declaration: { mode: 'interactive', relogin: true }, control: { relogin } })))
      .resolves.toMatchObject({ data: { code: 'unsupported' } });
    await expect(dispatchExtendedConsoleRpc('login.relogin', { adapter: 'demo', endpointKey: 'bot1' }, run(null)))
      .resolves.toEqual({ error: 'Endpoint not found: demo/bot1' });
    await expect(dispatchExtendedConsoleRpc('login.relogin', {}, run({}))).resolves.toHaveProperty('error');
  });

  it('every login RPC is registered with the expected permission', () => {
    const expected: Record<string, string> = {
      'login.list': 'endpoint.view', 'login.flow.list': 'endpoint.view', 'login.flow.get': 'endpoint.view',
      'login.submit': 'endpoint.operate', 'login.cancel': 'endpoint.operate',
      'login.relogin': 'endpoint.operate', 'login.refresh': 'endpoint.operate',
    };
    expect(Object.values(LOGIN_RPC).sort()).toEqual(Object.keys(expected).sort());
    for (const [type, permission] of Object.entries(expected)) expect(CONSOLE_RPC_PERMISSIONS[type]).toBe(permission);
    // Naming the Endpoint scopes the call, so adapter/endpoint-scoped operators can answer their own login.
    expect(resolveConsoleRpcPermission('login.relogin', { type: 'login.relogin', adapter: 'icqq', endpointKey: 'bot1' }))
      .toMatchObject({ permission: 'endpoint.operate', target: { kind: 'endpoint', adapter: 'icqq', endpoint: 'bot1' } });
  });

  it('audit detail carries the result category only', () => {
    expect(loginAuditDetail('login.submit', { accepted: true, outcome: { result: 'rejected', code: 'code_invalid', message: 'x' }, flow: {} }))
      .toEqual({ result: 'rejected', code: 'code_invalid' });
    expect(loginAuditDetail('login.submit', { accepted: true, pending: true })).toEqual({ result: 'pending' });
    expect(loginAuditDetail('login.submit', { success: true })).toEqual({ result: 'accepted' });
    expect(loginAuditDetail('login.relogin', { code: 'unsupported' })).toEqual({ result: 'unsupported' });
    expect(loginAuditDetail('login.flow.get', { flow: null })).toBeUndefined();
  });
});
