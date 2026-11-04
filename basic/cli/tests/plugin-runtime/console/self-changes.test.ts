import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { unrestrictedConsoleAccess, type ConsoleAccess } from '@zhin.js/host-http';
import { SelfChangeApprovals, SelfChangeStore } from '@zhin.js/agent';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { dispatchPluginConsoleRpcRequest } from '../../../src/plugin-runtime/console/plugin-console-rpc.js';
import { HostSelfChanges } from '../../../src/plugin-runtime/console/self-changes.js';
import { HostToolApprovals, composeHostConsoleRpc } from '../../../src/plugin-runtime/console/tool-approvals.js';

const stores: SnapshotStore[] = [];
let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'zhin-console-self-change-')); });
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  rmSync(project, { recursive: true, force: true });
});

function host(surface: HostSelfChanges, toolApprovals: HostToolApprovals) {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state); stores.push(store);
  const hostRpc = () => composeHostConsoleRpc(toolApprovals.consoleRpc, surface.consoleRpc);
  return (type: string, access: ConsoleAccess, data?: unknown) => dispatchPluginConsoleRpcRequest(
    { type, requestId: 1, ...(data === undefined ? {} : { data }) },
    { snapshots: store, access, pagesOwnedBy: () => [] as never, hostRpc },
  );
}

async function pendingChange(store: SelfChangeStore, approvals: SelfChangeApprovals, sceneId: string) {
  const draft = await store.draft({
    origin: { platform: 'icqq', sceneId, userId: '42', endpoint: 'bot-1' },
    files: [{ path: 'commands/ping.ts', content: 'export default 1; // SECRET_BODY\n' }],
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [] } });
  return approvals.submit(draft.id);
}

it('lists pending changes and lets ops:approve approve or reject them', async () => {
  const store = new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const surface = new HostSelfChanges();
  const toolApprovals = new HostToolApprovals(queue);
  const call = host(surface, toolApprovals);
  const reader: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:read'], roles: [] };
  const approver: ConsoleAccess = { unrestricted: false, permissions: ['ops:approve'], roles: [] };

  expect(await call('plugin.root.self-changes', reader)).toMatchObject({ status: 200, body: { data: { available: false } } });
  const unbind = surface.bind(store, approvals);
  const first = await pendingChange(store, approvals, 'group:1');
  const second = await pendingChange(store, approvals, 'group:2');

  const listed = await call('plugin.root.self-changes', reader);
  expect(listed).toMatchObject({ status: 200, body: { data: { available: true } } });
  const data = (listed as { body: { data: { pending: { id: string; approvalId: string }[]; usageBytes: number } } }).body.data;
  expect(data.pending.map(card => card.id).sort()).toEqual([first.record.id, second.record.id].sort());
  expect(data.pending.find(card => card.id === first.record.id)?.approvalId).toBe(first.approvalId);
  expect(data.usageBytes).toBeGreaterThan(0);
  expect(JSON.stringify(listed)).not.toContain('SECRET_BODY');

  expect(await call('plugin.root.resolve-self-change', reader, { id: first.record.id, decision: 'approve' })).toMatchObject({ status: 403 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'maybe' })).toMatchObject({ status: 400 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'approve' }))
    .toMatchObject({ status: 200, body: { data: { id: first.record.id, status: 'approved', approvedBy: 'console' } } });
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'reject' })).toMatchObject({ status: 409 });
  expect(await call('plugin.root.resolve-self-change', approver, { id: 'missing', decision: 'reject' })).toMatchObject({ status: 404 });

  // The same card is visible on the hard-gate surface; settling it there settles the change too.
  expect(await call('plugin.root.resolve-tool-approval', unrestrictedConsoleAccess, { id: second.approvalId, decision: 'deny' })).toMatchObject({ status: 200 });
  await approvals.drain();
  expect((await store.get(second.record.id))?.status).toBe('rejected');

  // Only `failed` changes can be marked handled.
  expect(await call('plugin.root.mark-self-change-handled', approver, { id: first.record.id })).toMatchObject({ status: 409 });
  unbind();
  expect(await call('plugin.root.resolve-self-change', approver, { id: first.record.id, decision: 'approve' })).toMatchObject({ status: 503 });
});

it('serves self-change-detail to ops:approve only, with diffs, redacted config values and skipped checks (#1142 F3)', async () => {
  const store = new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const surface = new HostSelfChanges();
  const toolApprovals = new HostToolApprovals(queue);
  const call = host(surface, toolApprovals);
  const reader: ConsoleAccess = { unrestricted: false, permissions: ['tool_approvals:read'], roles: [] };
  const approver: ConsoleAccess = { unrestricted: false, permissions: ['ops:approve'], roles: [] };
  surface.bind(store, approvals);

  mkdirSync(join(project, 'commands'), { recursive: true });
  writeFileSync(join(project, 'commands', 'ping.ts'), 'export default 1;\n');
  const draft = await store.draft({
    origin: { platform: 'icqq', sceneId: 'group:1', userId: '42', endpoint: 'bot-1' },
    files: [{ path: 'commands/ping.ts', content: 'export default 2;\n' }],
    configPatch: {
      expectedRevision: 'rev-1',
      patches: [
        { op: 'set', path: ['ping', 'apiKey'], value: 'sk-live-THIS_IS_SECRET' },
        { op: 'set', path: ['ping', 'greeting'], value: 'hello' },
        { op: 'remove', path: ['ping', 'legacy'] },
        { op: 'set', path: ['ping', 'a', 'b', 'c', 'd'], value: { nested: { list: [1, 2] } } },
        { op: 'set', path: ['ping', 'openaiApiKey'], value: 'plain-looking-value' },
        { op: 'set', path: ['ping', 'systemPrompt'], value: 'You are a very secret prompt' },
      ],
    },
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'ready', {
    actor: 'policy',
    trial: {
      passed: true,
      checks: [
        { check: 'syntax', path: 'commands/ping.ts', status: 'passed' },
        { check: 'sandbox_load', path: 'commands/ping.ts', status: 'skipped' },
        { check: 'plugin_tests', path: 'commands/ping.ts', status: 'failed', message: 'output: Bearer abcdefghijklmnop' },
        ...Array.from({ length: 60 }, (_, index) => ({ check: 'syntax', path: `commands/x${index}.ts`, status: 'passed' })),
      ],
      pendingStages: ['plugin_tests'],
    },
  });
  const { record, approvalId } = await approvals.submit(draft.id);

  expect(await call('plugin.root.self-change-detail', reader, { id: record.id })).toMatchObject({ status: 403 });
  expect(await call('plugin.root.self-change-detail', approver, {})).toMatchObject({ status: 400 });
  expect(await call('plugin.root.self-change-detail', approver, { id: 'missing' })).toMatchObject({ status: 404 });

  const response = await call('plugin.root.self-change-detail', approver, { id: record.id });
  expect(response).toMatchObject({
    status: 200,
    body: {
      data: {
        change: { id: record.id, status: 'pending', approvalId },
        bodiesAvailable: true,
        baseline: 'disk',
        diffTruncated: false,
        maxDiffBytes: 64 * 1024,
        files: [{ path: 'commands/ping.ts', kind: 'modify', truncated: false, unavailableReason: null }],
        configPatch: {
          expectedRevision: 'rev-1',
          operations: [
            { op: 'set', path: ['ping', 'apiKey'], value: '[redacted]' },
            { op: 'set', path: ['ping', 'greeting'], value: 'hello' },
            { op: 'remove', path: ['ping', 'legacy'] },
            { op: 'set', path: ['ping', 'a', 'b', 'c', 'd'], value: { nested: { list: [1, 2] } } },
            { op: 'set', path: ['ping', 'openaiApiKey'], value: '[redacted]' },
            { op: 'set', path: ['ping', 'systemPrompt'], value: '[omitted]' },
          ],
        },
        trial: { passed: true, pendingStages: ['plugin_tests'], skippedChecks: ['sandbox_load commands/ping.ts'] },
      },
    },
  });
  const data = (response as { body: { data: { files: { diff: string }[]; usageBytes: number; trial: { checks: unknown[] }; change: { trial: { checks: unknown[]; pendingStages: string[] } } } } }).body.data;
  expect(data.files[0]!.diff).toContain('-export default 1;\n+export default 2;');
  expect(data.usageBytes).toBeGreaterThan(0);
  // Every check is returned (no audit list cap) and the card's own trial is the sanitized copy.
  expect(data.trial.checks).toHaveLength(63);
  expect(data.trial.checks[2]).toEqual({ check: 'plugin_tests', path: 'commands/ping.ts', status: 'failed', message: 'output: Bearer [redacted]' });
  expect(data.change.trial.checks).toEqual(data.trial.checks);
  expect(data.change.trial.pendingStages).toEqual(['plugin_tests']);
  expect(JSON.stringify(response)).not.toContain('plain-looking-value');
  expect(JSON.stringify(response)).not.toContain('very secret prompt');
  expect(JSON.stringify(response)).not.toContain('THIS_IS_SECRET');
  expect(JSON.stringify(response)).not.toContain('abcdefghijklmnop');

  // The read-only hard-gate list never carries the excerpt that the IM card shows.
  const listed = await call('plugin.root.tool-approvals', reader);
  expect(JSON.stringify(listed)).not.toContain('export default 2');
  expect(JSON.stringify(listed)).toContain(record.id);

  // Once decided the change is slimmed: no diff is invented.
  await call('plugin.root.resolve-self-change', approver, { id: record.id, decision: 'reject' });
  const slimmed = await call('plugin.root.self-change-detail', approver, { id: record.id });
  expect(slimmed).toMatchObject({
    status: 200,
    body: {
      data: {
        change: { status: 'rejected', slimmed: true },
        bodiesAvailable: false,
        files: [{ path: 'commands/ping.ts', diff: null, unavailableReason: 'slimmed' }],
      },
    },
  });
});

it('cuts self-change-detail diffs at the 64 KB budget', async () => {
  const store = new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const surface = new HostSelfChanges();
  const call = host(surface, new HostToolApprovals(queue));
  surface.bind(store, approvals);
  const line = `// ${'y'.repeat(100)}`;
  const big = Array.from({ length: 1_000 }, () => line).join('\n');
  const draft = await store.draft({
    origin: { platform: 'icqq', sceneId: 'group:3', userId: '42', endpoint: 'bot-1' },
    files: [
      { path: 'commands/big.ts', content: big },
      { path: 'commands/after.ts', content: 'export default 1;\n' },
    ],
  });
  const response = await call('plugin.root.self-change-detail', unrestrictedConsoleAccess, { id: draft.id });
  const data = (response as { body: { data: { diffBytes: number; diffTruncated: boolean; files: { truncated: boolean; unavailableReason: string | null }[] } } }).body.data;
  expect(data.diffTruncated).toBe(true);
  expect(data.diffBytes).toBeLessThanOrEqual(64 * 1024);
  expect(data.files[0]).toMatchObject({ truncated: true, unavailableReason: null });
  expect(data.files[1]).toMatchObject({ truncated: true, unavailableReason: 'budget_exhausted' });
});

it('redacts the detail diff, allow-lists the nested trial and redacts change.error (#1145 cubic)', async () => {
  const store = new SelfChangeStore({ root: join(project, '.zhin', 'changes'), projectRoot: project });
  const queue = new ToolApprovalQueue();
  const approvals = new SelfChangeApprovals({ store, queue });
  const surface = new HostSelfChanges();
  const call = host(surface, new HostToolApprovals(queue));
  surface.bind(store, approvals);
  const draft = await store.draft({
    origin: { platform: 'icqq', sceneId: 'group:4', userId: '42', endpoint: 'bot-1' },
    files: [{ path: 'commands/ping.ts', content: 'const apiKey = "DIFF_SECRET_VALUE";\nexport default 1;\n' }],
  });
  const pendingResponse = await call('plugin.root.self-change-detail', unrestrictedConsoleAccess, { id: draft.id });
  const pendingData = (pendingResponse as { body: { data: { files: { diff: string }[] } } }).body.data;
  expect(pendingData.files[0]!.diff).toContain('+const apiKey = "[redacted]";');
  expect(JSON.stringify(pendingResponse)).not.toContain('DIFF_SECRET_VALUE');

  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  await store.transition(draft.id, 'trial_failed', {
    actor: 'policy',
    error: 'plugin_tests commands/ping.ts: password = hunter2 phrase; Bearer abcdefghijklmnop',
    trial: {
      version: 1,
      passed: false,
      contentHash: draft.contentHash,
      checks: [{ check: 'plugin_tests', path: 'commands/ping.ts', status: 'failed', message: 'password = hunter2 phrase; Bearer abcdefghijklmnop' }],
      pendingStages: [],
      startedAt: 1,
      durationMs: 2,
      rawOutput: 'EXTRA_TRIAL_FIELD_SECRET',
    },
  });
  const response = await call('plugin.root.self-change-detail', unrestrictedConsoleAccess, { id: draft.id });
  const data = (response as { body: { data: { change: { error: string | null; trial: Record<string, unknown> } } } }).body.data;
  expect(Object.keys(data.change.trial).sort()).toEqual(['checks', 'contentHash', 'durationMs', 'passed', 'pendingStages', 'startedAt', 'version']);
  expect(data.change.trial).toMatchObject({ version: 1, passed: false, contentHash: draft.contentHash, startedAt: 1, durationMs: 2 });
  expect(data.change.error).toContain('password = [redacted]');
  const text = JSON.stringify(response);
  expect(text).not.toContain('EXTRA_TRIAL_FIELD_SECRET');
  expect(text).not.toContain('hunter2');
  expect(text).not.toContain('abcdefghijklmnop');
});
