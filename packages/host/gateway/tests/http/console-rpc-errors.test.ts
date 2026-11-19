import type { RouteContext, TokenRegistry } from '@zhin.js/host-http';
import { GATEWAY_RPC, type GatewayRpcResponse } from '@zhin.js/console-protocol';
import { createGatewayConsoleRpc } from '../../src/http/console-rpc.js';
import { testUser } from '../utils/console-users.js';

const context = { principal: testUser('owner') } as unknown as RouteContext;
const registry = {} as TokenRegistry;

describe('gateway Console RPC error envelope', () => {
  it('adds structured errors and missingEnv to an invalid_input reply, keeping the message', async () => {
    const errors = [{ path: '$.endpoints.0.id', message: '缺少必填项' }];
    const rpc = createGatewayConsoleRpc(async (): Promise<GatewayRpcResponse> => ({ ok: false,
      error: { code: 'invalid_input', message: '配置未通过插件 Schema 校验', status: 400, errors, missingEnv: ['BOT_TOKEN'] } }));
    const response = await rpc.handle({ type: GATEWAY_RPC.DECLARE, requestId: 'r1', data: {} }, context, registry);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false, code: 'invalid_input', error: '配置未通过插件 Schema 校验', requestId: 'r1', errors, missingEnv: ['BOT_TOKEN'],
    });
  });

  it('does not audit a successful version check as a write', async () => {
    const audits: Array<{ action: string; outcome: string }> = [];
    const registry = {
      accessProvider: { audit: (event: { action: string; outcome: string }) => { audits.push(event); } },
    } as unknown as TokenRegistry;
    const rpc = createGatewayConsoleRpc(async (request): Promise<GatewayRpcResponse> => (
      request.type === GATEWAY_RPC.CHECK
        ? { ok: true, data: { packages: [] } }
        : { ok: true, data: {} }
    ));
    const response = await rpc.handle({ type: GATEWAY_RPC.CHECK, requestId: 'v1' }, context, registry);
    expect(response.status).toBe(200);
    expect(audits).toEqual([]);
    await rpc.handle({ type: GATEWAY_RPC.INSTALL, requestId: 'w1' }, context, registry);
    expect(audits).toEqual([expect.objectContaining({ action: 'rpc:gateway.packages.install', outcome: 'ok' })]);

    const denying = createGatewayConsoleRpc(async (): Promise<GatewayRpcResponse> => ({
      ok: false, error: { code: 'forbidden', message: '缺少权限 status.view', status: 403 },
    }));
    await denying.handle({ type: GATEWAY_RPC.CHECK }, context, registry);
    expect(audits.map(event => `${event.action}:${event.outcome}`)).toEqual([
      'rpc:gateway.packages.install:ok',
      'rpc:gateway.version.check:denied',
    ]);
  });

  it('keeps the plain error reply when there are no details', async () => {
    const rpc = createGatewayConsoleRpc(async (): Promise<GatewayRpcResponse> => ({ ok: false,
      error: { code: 'conflict', message: 'busy', status: 409 } }));
    const response = await rpc.handle({ type: GATEWAY_RPC.DECLARE, requestId: 2 }, context, registry);
    expect(await response.json()).toEqual({ success: false, code: 'conflict', error: 'busy', requestId: 2 });
  });
});
