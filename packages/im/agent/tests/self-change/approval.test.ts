import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';
import {
  SELF_CHANGE_APPROVAL_TOOL,
  SelfChangeApprovals,
  SelfChangePendingLimitError,
  approvalOrigin,
} from '../../src/self-change/approval.js';
import { SelfChangeStateError, SelfChangeStore, type SelfChangeOrigin } from '../../src/self-change/store.js';

const HOUR = 60 * 60 * 1000;
const origin: SelfChangeOrigin = { platform: 'icqq', sceneId: 'group:500', userId: '42', endpoint: 'bot-1' };

let project: string;
let clock: number;
let audit: DecisionEventInput[];

async function makeStore(): Promise<SelfChangeStore> {
  return new SelfChangeStore({
    root: join(project, '.zhin', 'changes'),
    projectRoot: project,
    protectedPaths: await createHostProtectedPaths({ projectRoot: project }),
    audit: () => ({ record: (input) => { audit.push(input); } }),
    now: () => clock,
  });
}

async function readyChange(store: SelfChangeStore, from: SelfChangeOrigin = origin, content = 'export default 1;\n') {
  const draft = await store.draft({ origin: from, files: [{ path: 'commands/ping.ts', content }] });
  await store.attachPlan(draft.id, draft.contentHash, {
    version: 1,
    contentHash: draft.contentHash,
    summary: '加一个 /ping 指令',
    files: [{ path: 'commands/ping.ts', kind: 'create', added: 1, removed: 0, bytesBefore: null, bytesAfter: 18 }],
    impact: { kind: 'generation', subtrees: ['app'], slots: [], reasons: [], estimated: false, config: null },
  });
  await store.transition(draft.id, 'trialing', { actor: 'policy', reasonCode: 'change_drafted' });
  return store.transition(draft.id, 'ready', { actor: 'policy', trial: { passed: true, checks: [{ status: 'passed' }, { status: 'skipped' }] } });
}

function setup(store: SelfChangeStore, queue = new ToolApprovalQueue({ now: () => clock })) {
  return { queue, approvals: new SelfChangeApprovals({ store, queue, now: () => clock }) };
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'zhin-change-approval-'));
  clock = 1_700_000_000_000;
  audit = [];
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe('SelfChangeApprovals', () => {
  it('submits a ready change as a self-category card without file bodies', async () => {
    const store = await makeStore();
    const { queue, approvals } = setup(store);
    const ready = await readyChange(store);
    const { record, approvalId } = await approvals.submit(ready.id);
    expect(record.status).toBe('pending');
    const card = queue.get(approvalId)!;
    expect(card).toMatchObject({
      toolName: SELF_CHANGE_APPROVAL_TOOL,
      category: 'self',
      requesterId: '42',
      status: 'pending',
      origin: { platform: 'icqq', endpointKey: 'bot-1', scope: 'group', sceneId: '500' },
      args: {
        changeId: ready.id,
        contentHash: ready.contentHash,
        summary: '加一个 /ping 指令',
        files: [{ path: 'commands/ping.ts', kind: 'create', added: 1, removed: 0 }],
        impact: 'generation',
        trial: 'passed (1 skipped)',
      },
    });
    expect(card.expiresAt - card.createdAt).toBe(24 * HOUR);
    expect(JSON.stringify(card.args)).not.toContain('export default');
    expect(audit.at(-1)).toMatchObject({ reasonCode: 'change_submitted', outcome: 'defer' });
  });

  it('only submits ready changes and allows one pending change per conversation', async () => {
    const store = await makeStore();
    const { approvals } = setup(store);
    const draft = await store.draft({ origin, files: [{ path: 'commands/a.ts', content: 'x' }] });
    await expect(approvals.submit(draft.id)).rejects.toBeInstanceOf(SelfChangeStateError);
    const first = await readyChange(store);
    await approvals.submit(first.id);
    const second = await readyChange(store, origin, 'export default 2;\n');
    await expect(approvals.submit(second.id)).rejects.toBeInstanceOf(SelfChangePendingLimitError);
    expect((await store.get(second.id))?.status).toBe('ready');
    expect((await approvals.pendingFor(origin))?.id).toBe(first.id);
    // Another conversation is independent.
    const elsewhere = await readyChange(store, { ...origin, sceneId: 'private:42' });
    await expect(approvals.submit(elsewhere.id)).resolves.toMatchObject({ record: { status: 'pending' } });
  });

  it('approves through a human channel and binds the approver and content hash', async () => {
    const store = await makeStore();
    const { queue, approvals } = setup(store);
    const ready = await readyChange(store);
    const { approvalId } = await approvals.submit(ready.id);
    queue.resolve(approvalId, true, 'im:icqq:42', { channel: 'im_dm' });
    await approvals.drain();
    const record = await store.get(ready.id);
    expect(record).toMatchObject({ status: 'approved', approvedBy: 'im:icqq:42', approvedHash: ready.contentHash });
    expect(audit.at(-1)).toMatchObject({ reasonCode: 'change_approved', actor: 'operator', actorId: 'im:icqq:42', payload: expect.objectContaining({ approvalId, channel: 'im_dm' }) });
  });

  it('never accepts an approval without a human channel (approval port / bypass)', async () => {
    const store = await makeStore();
    const { queue, approvals } = setup(store);
    const ready = await readyChange(store);
    const { approvalId } = await approvals.submit(ready.id);
    queue.resolve(approvalId, true, 'approval_port');
    await approvals.drain();
    expect(await store.get(ready.id)).toMatchObject({ status: 'rejected', approvedBy: null });
    expect(audit.at(-1)).toMatchObject({ reasonCode: 'change_rejected', actor: 'policy' });
  });

  it('rejects when the content no longer matches the card', async () => {
    const store = await makeStore();
    const { queue, approvals } = setup(store);
    const ready = await readyChange(store);
    const { approvalId } = await approvals.submit(ready.id);
    // Simulate a tampered card: same change, different bound hash.
    const card = queue.get(approvalId)!;
    (card.args as Record<string, unknown>).contentHash = 'sha256:other';
    queue.resolve(approvalId, true, 'console', { channel: 'console' });
    await approvals.drain();
    expect((await store.get(ready.id))?.status).toBe('rejected');
    expect(audit.at(-1)).toMatchObject({ reasonCode: 'change_hash_mismatch', outcome: 'deny' });
  });

  it('records denials and timeouts, slimming the staged files', async () => {
    const store = await makeStore();
    const { queue, approvals } = setup(store);
    const denied = await readyChange(store);
    const { approvalId } = await approvals.submit(denied.id);
    queue.resolve(approvalId, false, 'console', { channel: 'console' });
    await approvals.drain();
    expect(await store.get(denied.id)).toMatchObject({ status: 'rejected', slimmed: true });
    expect(await store.readStagedFile(denied.id, 'commands/ping.ts')).toBeNull();

    const timedOut = await readyChange(store);
    await approvals.submit(timedOut.id);
    clock += 24 * HOUR + 1;
    queue.list(); // expires due cards
    await approvals.drain();
    expect(await store.get(timedOut.id)).toMatchObject({ status: 'expired', slimmed: true });
  });

  it('decides by change id for the Console and refuses a second decision', async () => {
    const store = await makeStore();
    const { approvals } = setup(store);
    const ready = await readyChange(store);
    await approvals.submit(ready.id);
    await expect(approvals.decide(ready.id, true, 'console', 'console')).resolves.toMatchObject({ status: 'approved', approvedBy: 'console' });
    await expect(approvals.decide(ready.id, false, 'console', 'console')).rejects.toBeInstanceOf(SelfChangeStateError);
  });

  it('restores cards for pending changes after a restart and expires overdue ones', async () => {
    const store = await makeStore();
    const before = setup(store);
    const kept = await readyChange(store);
    await before.approvals.submit(kept.id);
    const other = await readyChange(store, { ...origin, sceneId: 'private:7' });
    await before.approvals.submit(other.id);
    // Old generation goes away: its queue drops the cards, which must not settle the changes.
    before.approvals.dispose();
    before.queue.dispose();
    await before.approvals.drain();
    expect((await store.get(kept.id))?.status).toBe('pending');

    clock += 2 * HOUR;
    const after = setup(store);
    expect(await after.approvals.restore()).toBe(2);
    const card = after.queue.get(after.approvals.approvalIdFor(kept.id)!)!;
    expect(card.expiresAt - clock).toBe(22 * HOUR);

    clock += 23 * HOUR;
    const later = setup(store);
    expect(await later.approvals.restore()).toBe(0);
    expect((await store.get(kept.id))?.status).toBe('expired');
    expect((await store.get(other.id))?.status).toBe('expired');
  });

  it('maps the change origin to an approval origin', () => {
    expect(approvalOrigin(origin)).toEqual({ platform: 'icqq', endpointKey: 'bot-1', scope: 'group', sceneId: '500' });
    expect(approvalOrigin({ ...origin, sceneId: 'private:42' })).toMatchObject({ scope: 'private', sceneId: '42' });
    expect(approvalOrigin({ ...origin, endpoint: null })).toBeNull();
  });
});
