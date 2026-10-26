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
