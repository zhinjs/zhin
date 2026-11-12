import { afterEach, expect, it, vi } from 'vitest';
import { definePluginConsoleRpc, generationAdmissionSource, GenerationAdmissionGate } from '../src/index.js';

const handler = async () => null;

it('normalizes status and actions and exposes one admission gate', () => {
  const rpc = definePluginConsoleRpc({
    status: { handler, page: 'ambient', demo: true, requiredPermissions: ['b', 'a', 'a'] },
    actions: { 'reset-cooldown': { handler } },
  });
  expect([...rpc.methods.keys()]).toEqual(['status', 'reset-cooldown']);
  expect(rpc.methods.get('status')).toMatchObject({ page: 'ambient', demo: true, requiredPermissions: ['a', 'b'], requiredRoles: [] });
  expect(rpc.methods.get('reset-cooldown')?.demo).toBe(false);
  expect(rpc[generationAdmissionSource]).toHaveLength(1);
  expect(rpc[generationAdmissionSource][0]).toBeInstanceOf(GenerationAdmissionGate);
});

it('rejects empty, reserved and malformed declarations at setup time', () => {
  expect(() => definePluginConsoleRpc({})).toThrow(/status or at least one action/u);
  expect(() => definePluginConsoleRpc({ actions: { status: { handler } } })).toThrow(/reserved/u);
  expect(() => definePluginConsoleRpc({ actions: { 'Bad.Name': { handler } } })).toThrow(/Invalid/u);
  expect(() => definePluginConsoleRpc({ status: { handler, page: '../x' } })).toThrow(/page/u);
  expect(() => definePluginConsoleRpc({ status: {} as never })).toThrow(/handler/u);
  expect(() => definePluginConsoleRpc({ status: { handler, requiredRoles: [''] } })).toThrow(/non-empty/u);
});

it('treats named queries as read-only methods with the status access rules', () => {
  const rpc = definePluginConsoleRpc({
    queries: { ambient: { handler, demo: true, requiredPermissions: ['ambient:read'] } },
    actions: { reset: { handler } },
  });
  expect(rpc.methods.get('ambient')).toMatchObject({ readOnly: true, demo: true, requiredPermissions: ['ambient:read'] });
  expect(rpc.methods.get('reset')).toMatchObject({ readOnly: false, demo: false });
  expect(() => definePluginConsoleRpc({ queries: { x: { handler } }, actions: { x: { handler } } })).toThrow(/Duplicate/u);
  expect(() => definePluginConsoleRpc({ queries: { status: { handler } } })).toThrow(/reserved/u);
});

it('supports definePluginConsoleRpc.withConfig<TConfig>() and typed call.config', async () => {
  interface MyPluginConfig {
    readonly prefix: string;
    readonly maxItems: number;
  }
  const defineRpc = definePluginConsoleRpc.withConfig<MyPluginConfig>();
  const rpc = defineRpc({
    status: {
      handler(_input, call) {
        return {
          prefix: call.config?.prefix ?? 'default',
          maxItems: call.config?.maxItems ?? 10,
        };
      },
    },
    actions: {
      ping: {
        handler(input, call) {
          return `${call.config?.prefix ?? ''}:${String(input.msg ?? '')}`;
        },
      },
    },
  });
  const statusMethod = rpc.methods.get('status')!;
  const signal = new AbortController().signal;
  expect(statusMethod.handler({}, { signal, config: { prefix: 'zhin', maxItems: 42 } })).toEqual({
    prefix: 'zhin',
    maxItems: 42,
  });
  const pingMethod = rpc.methods.get('ping')!;
  expect(pingMethod.handler({ msg: 'ok' }, { signal, config: { prefix: 'bot', maxItems: 5 } })).toBe('bot:ok');
});

it('normalizes declared permission levels (ADR 0049 amendment 2026-11-11)', () => {
  const rpc = definePluginConsoleRpc({
    permissions: [{ id: 'rss:write', level: 'operate', description: ' 编辑订阅 ' }, { id: 'rss:read', level: 'read' }],
    status: { handler, requiredPermissions: ['rss:read'] },
  });
  expect(rpc.permissions).toEqual([{ id: 'rss:write', level: 'operate', description: '编辑订阅' }, { id: 'rss:read', level: 'read' }]);
  expect(definePluginConsoleRpc({ status: { handler } }).permissions).toBeUndefined();
  const define = (permissions: unknown) => () => definePluginConsoleRpc({ permissions: permissions as never, status: { handler } });
  expect(define('rss:read')).toThrow(/must be an array/u);
  expect(define([{ id: 'rss.read', level: 'read' }])).toThrow(/<plugin>:<action>/u);
  expect(define([{ id: 'rss:read', level: 'admin' }])).toThrow(/level/u);
  expect(define([{ id: 'rss:read', level: 'read' }, { id: 'rss:read', level: 'manage' }])).toThrow(/Duplicate/u);
  expect(define([{ id: 'rss:read', level: 'read', scope: 'x' }])).toThrow(/unknown keys/u);
  expect(define([{ id: 'rss:read', level: 'read', description: ' ' }])).toThrow(/description/u);
});
