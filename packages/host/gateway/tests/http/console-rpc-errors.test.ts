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

  it('keeps the plain error reply when there are no details', async () => {
    const rpc = createGatewayConsoleRpc(async (): Promise<GatewayRpcResponse> => ({ ok: false,
      error: { code: 'conflict', message: 'busy', status: 409 } }));
    const response = await rpc.handle({ type: GATEWAY_RPC.DECLARE, requestId: 2 }, context, registry);
    expect(await response.json()).toEqual({ success: false, code: 'conflict', error: 'busy', requestId: 2 });
  });
});
