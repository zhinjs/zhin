import { describe, expect, it } from 'vitest';
import { CONFIG_RPC, DEMO_RPC_WRITE_BLOCKLIST, type ConsoleConfigPatchRequest, type ConsoleConfigPatchResult } from '@zhin.js/console-protocol';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../src/console-rpc.js';

const revision = 'a'.repeat(64);
const message = (extra: Record<string, unknown>) => ({ type: CONFIG_RPC.PATCH, requestId: 1, expectedRevision: revision,
  patches: [{ op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'shadow' }], ...extra });

function context(result: ConsoleConfigPatchResult | Error, authScope: 'full' | 'demo' = 'full') {
  const calls: ConsoleConfigPatchRequest[] = [];
  const events: Array<[string, unknown]> = [];
  return { calls, events, ctx: {
    authScope, listPages: async () => [],
    patchConfig: async (request: ConsoleConfigPatchRequest) => {
      calls.push(request);
      if (result instanceof Error) throw result;
      return result;
    },
    publishEvent: (type: string, data: unknown) => { events.push([type, data]); },
  } };
}

describe('config:patch RPC', () => {
  it('forwards a Host-scoped patch and publishes config:updated with exact paths', async () => {
    const paths = [['ai', 'trigger', 'ambient', 'mode']];
    const { calls, events, ctx } = context({ status: 'saved', revision: 'b'.repeat(64), restartRequired: true, paths,
      missingEnv: [], message: '配置已保存，需重启进程才能生效' });
    const reply = pickRpcReply(message({}), await dispatchRuntimeConsoleRpc(message({}), ctx));
    expect(reply).toMatchObject({ requestId: 1, data: { status: 'saved', restartRequired: true } });
    expect(calls).toEqual([{ expectedRevision: revision, patches: message({}).patches }]);
    expect(events).toEqual([['config:updated', { pluginName: null, keys: ['ai'], paths, revision: 'b'.repeat(64) }]]);
  });

  it('returns conflict and invalid results as data without publishing an update', async () => {
    for (const result of [
      { status: 'conflict', revision: 'c'.repeat(64), current: [{ path: ['typesafe', 'model'], value: 'jev-1' }], message: 'x' },
      { status: 'invalid', revision, errors: [{ path: '$.typesafe.model', message: 'bad' }], missingEnv: [], message: 'y' },
    ] as ConsoleConfigPatchResult[]) {
      const { events, ctx } = context(result);
      const request = message({ instanceKey: 'typesafe', patches: [{ op: 'set', path: ['typesafe', 'model'], value: '' }] });
      expect(pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, ctx))?.data).toEqual(result);
      expect(events).toEqual([]);
    }
  });

  it('requires full scope, a revision and a valid scope field before calling the store', async () => {
    const saved = { status: 'saved', revision, restartRequired: false, paths: [], missingEnv: [], message: '' } as const;
    const cases: Array<[Record<string, unknown>, 'full' | 'demo', RegExp]> = [
      [{}, 'demo', /Demo scope/],
      [{ expectedRevision: 'stale' }, 'full', /expectedRevision/],
      [{ instanceKey: 42 }, 'full', /instanceKey/],
      [{ patches: 'ai.enabled=false' }, 'full', /patches/],
    ];
    for (const [extra, scope, error] of cases) {
      const { calls, ctx } = context(saved, scope);
      const request = message(extra);
      expect(pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, ctx))?.error).toMatch(error);
      expect(calls).toEqual([]);
    }
    expect(DEMO_RPC_WRITE_BLOCKLIST.has(CONFIG_RPC.PATCH)).toBe(true);
  });

  it('reports scope violations as errors', async () => {
    const { events, ctx } = context(new Error('路径 ai.enabled 不在 Host 白名单 可写范围内'));
    const reply = pickRpcReply(message({}), await dispatchRuntimeConsoleRpc(message({ patches: [{ op: 'set', path: ['ai', 'enabled'], value: false }] }), ctx));
    expect(reply?.error).toMatch(/Failed to patch config: 路径 ai.enabled/);
    expect(events).toEqual([]);
  });
});
