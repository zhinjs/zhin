/**
 * zhinjs/zhin#1250: an RPC the Host does not have answers `unknown_rpc` and is not audited; an RPC
 * the Host handles but forgot to map stays an audited refusal; every audited refusal carries a
 * reason code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG_RPC,
  CONSOLE_DENIAL_REASONS,
  ENDPOINT_RPC,
  PLUGIN_RPC,
  resolveConsoleRpcPermission,
} from '@zhin.js/console-protocol';
import {
  authorizeConsoleHttp,
  authorizeConsoleRpc,
  isAuditedRpcDenial,
  webSocketDenialReason,
} from '../src/access-control.js';
import { isRuntimeConsoleRpcType, RUNTIME_CONSOLE_RPC_TYPES } from '../src/console-rpc-types.js';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../src/console-rpc.js';
import { createUnknownRpcLog } from '../src/unknown-rpc.js';
import { VIEWER, userPrincipal } from './fixtures/principals.js';

const SRC = join(import.meta.dirname, '..', 'src');

describe('unknown RPC vs unmapped RPC', () => {
  const owner = userPrincipal('owner');

  it('answers unknown_rpc for a type that has neither a handler nor a permission entry', () => {
    const decision = authorizeConsoleRpc(owner, { type: 'attention.lost' }, { registered: () => false });
    expect(decision).toMatchObject({ allowed: false, code: 'unknown_rpc', permission: null });
    expect(decision.allowed ? '' : decision.error).toBe('RPC "attention.lost" 不存在');
    expect(isAuditedRpcDenial(decision)).toBe(false);
    // The type in the error is truncated; nothing else is disclosed.
    const long = authorizeConsoleRpc(owner, { type: `x${'y'.repeat(200)}` }, { registered: () => false });
    expect(long.allowed ? '' : long.error.length).toBeLessThan(80);
  });

  it('keeps a registered but unmapped type an audited refusal with a reason', () => {
    const decision = authorizeConsoleRpc(owner, { type: 'handled.but.unmapped' }, { registered: () => true });
    expect(decision).toMatchObject({ allowed: false, code: 'unmapped', reason: CONSOLE_DENIAL_REASONS.UNMAPPED_PERMISSION });
    expect(isAuditedRpcDenial(decision)).toBe(true);
    // Without a predicate nothing is loosened: the refusal stays `unmapped` and audited.
    expect(authorizeConsoleRpc(owner, { type: 'handled.but.unmapped' })).toMatchObject({ allowed: false, code: 'unmapped' });
  });

  it('never consults the predicate for mapped types and never admits an unknown one', () => {
    let asked = 0;
    const registered = () => { asked += 1; return false; };
    expect(authorizeConsoleRpc(owner, { type: 'ping' }, { registered })).toMatchObject({ allowed: true });
    expect(authorizeConsoleRpc(VIEWER, { type: 'config:replace-source' }, { registered })).toMatchObject({ allowed: false, code: 'forbidden' });
    expect(asked).toBe(0);
    // A bootstrap token before setup is refused as before, known type or not.
    expect(authorizeConsoleRpc({ kind: 'bootstrap', open: false }, { type: 'made.up' }, { registered }))
      .toMatchObject({ allowed: false, code: 'setup_required', reason: CONSOLE_DENIAL_REASONS.SETUP_REQUIRED });
  });

  it('tells scope refusals from missing permissions', () => {
    const adapterOperator = userPrincipal('operator', { kind: 'adapter', key: 'qq' });
    const send = { type: 'endpoint.send_message', data: { adapter: 'tg', endpointKey: 'bot-1' } };
    expect(authorizeConsoleRpc(adapterOperator, send)).toMatchObject({ allowed: false, code: 'forbidden', reason: CONSOLE_DENIAL_REASONS.SCOPE_DENIED });
    expect(authorizeConsoleRpc(VIEWER, { type: 'config:replace-source' })).toMatchObject({ reason: CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION });
  });

  it('gives HTTP and WebSocket refusals a reason', () => {
    expect(authorizeConsoleHttp(undefined, 'GET', '/stats')).toMatchObject({ allowed: false, reason: CONSOLE_DENIAL_REASONS.NOT_AUTHENTICATED });
    expect(authorizeConsoleHttp(VIEWER, 'GET', '/nope')).toMatchObject({ allowed: false, reason: CONSOLE_DENIAL_REASONS.UNMAPPED_ROUTE });
    expect(authorizeConsoleHttp(VIEWER, 'DELETE', '/logs')).toMatchObject({ allowed: false, reason: CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION });
    expect(authorizeConsoleHttp({ kind: 'bootstrap', open: false }, 'GET', '/stats')).toMatchObject({ reason: CONSOLE_DENIAL_REASONS.SETUP_REQUIRED });
    // The capability read is open to every signed-in principal.
    expect(authorizeConsoleHttp(userPrincipal('operator', { kind: 'endpoint', key: 'qq/bot-1' }), 'GET', '/console/capabilities')).toMatchObject({ allowed: true });
    expect(authorizeConsoleHttp(undefined, 'GET', '/console/capabilities')).toMatchObject({ allowed: false, status: 401 });
    expect(webSocketDenialReason(VIEWER, '/sandbox/qq')).toBe(CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION);
    expect(webSocketDenialReason(VIEWER, '/elsewhere')).toBe(CONSOLE_DENIAL_REASONS.UNMAPPED_ROUTE);
  });
});

describe('runtime dispatcher', () => {
  it('does not run an unknown type and answers unknown_rpc', async () => {
    const listPages = vi.fn(async () => []);
    const replies = await dispatchRuntimeConsoleRpc({ type: 'attention.list.v9', requestId: 1 }, { authScope: 'full', principal: userPrincipal('owner'), listPages });
    expect(pickRpcReply({ type: 'attention.list.v9', requestId: 1 }, replies)).toMatchObject({ code: 'unknown_rpc' });
    expect(listPages).not.toHaveBeenCalled();
  });

  it('answers unknown_rpc on an open Host for a type nothing handles', async () => {
    const replies = await dispatchRuntimeConsoleRpc({ type: 'made.up', requestId: 2 }, { authScope: 'full', principal: { kind: 'bootstrap', open: true }, listPages: async () => [] });
    expect(pickRpcReply({ type: 'made.up', requestId: 2 }, replies)).toMatchObject({ code: 'unknown_rpc' });
  });

  it('lists every type its dispatchers handle, and each is mapped', () => {
    const constants: Record<string, Record<string, string>> = { CONFIG_RPC, ENDPOINT_RPC, PLUGIN_RPC };
    const files = ['console-rpc.ts', 'console-rpc-handlers.ts', 'console-rpc-extended/dispatcher.ts', 'console-plugin-rpc.ts'];
    const labels = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const match of source.matchAll(/^\s*case\s+(?:'([^']+)'|([A-Z_]+)\.([A-Z_]+))\s*:/gmu)) {
        labels.add(match[1] ?? constants[match[2]!]![match[3]!]!);
      }
    }
    expect(labels.size).toBeGreaterThan(80);
    for (const label of labels) expect(isRuntimeConsoleRpcType(label), label).toBe(true);
    for (const type of RUNTIME_CONSOLE_RPC_TYPES) expect(resolveConsoleRpcPermission(type), type).not.toBeNull();
  });
});

describe('unknown RPC log', () => {
  it('logs each type at most once per window and counts repeats', () => {
    const entries: unknown[] = [];
    const log = createUnknownRpcLog(entry => entries.push(entry));
    expect(log.note('attention.list', 0)).toBe(true);
    for (let i = 1; i <= 5; i += 1) expect(log.note('attention.list', i * 30_000)).toBe(false);
    expect(log.note('other.rpc', 1)).toBe(true);
    expect(log.note('attention.list', 11 * 60_000)).toBe(true);
    expect(entries).toEqual([
      { op: 'console_rpc_unknown', type: 'attention.list' },
      { op: 'console_rpc_unknown', type: 'other.rpc' },
      { op: 'console_rpc_unknown', type: 'attention.list', repeated: 5 },
    ]);
  });
});
