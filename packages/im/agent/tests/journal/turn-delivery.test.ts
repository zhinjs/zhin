import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournalStore } from '../../src/journal/file-journal-store.js';
import { PersistentTurnJournal } from '../../src/journal/persistent-turn-journal.js';
import { recordFinalReply, type TurnDeliveryRecord } from '../../src/journal/turn-delivery.js';
import type { DeliveryOutcome } from '../../src/turn/turn-ingress.js';

const conversation = { endpoint: { adapter: 'sandbox', id: 'root:sandbox' }, kind: 'group' as const, id: 'room' };
const identity = { run: { sessionId: 'sandbox:bot:group:room', turnId: 'turn' }, subjectId: 'owner',
  origin: { kind: 'im' as const, platform: 'sandbox', endpoint: 'bot', scope: 'group' as const, sceneId: 'room', conversation } };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhin-result-delivery-')); });
afterEach(async () => { await rm(directory, { force: true, recursive: true }); });

it('persists actual final delivery facts across restart beside the existing terminal journal, without inventing history', async () => {
  const store = new FileJournalStore(directory), journal = new PersistentTurnJournal(identity.run, store);
  const port = recordFinalReply({ send: async () => ({ status: 'failed', code: 'sandbox_delivery_unavailable', retryable: true }) },
    identity, () => journal.terminal?.terminal === 'completed', store, vi.fn());
  await port.send([{ type: 'text', content: 'progress' }]);
  await journal.append({ type: 'turn_end', output: [{ type: 'text', content: 'finished while away' }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
  await port.send([{ type: 'text', content: 'finished while away' }]);
  const restarted = new FileJournalStore(directory);
  expect(await restarted.replay(identity.run)).toHaveLength(2);
  expect(await restarted.listResults(identity.run.sessionId, 'owner', conversation)).toMatchObject([{
    turnId: 'turn', message: 'finished while away', deliveries: [{ status: 'not_sent', outcome: 'failed', code: 'sandbox_delivery_unavailable' }],
  }]);
  expect(await restarted.listResults(identity.run.sessionId, 'another-owner', conversation)).toEqual([]);
  expect(await restarted.listResults(identity.run.sessionId, 'owner', { ...conversation, kind: 'private' })).toEqual([]);
  expect(await restarted.listResults(identity.run.sessionId, 'owner', { ...conversation, endpoint: { ...conversation.endpoint, id: 'another-bot' } })).toEqual([]);
});

it('does not claim old completed journal runs without recorded delivery facts were not delivered', async () => {
  const store = new FileJournalStore(directory), journal = new PersistentTurnJournal(identity.run, store);
  await journal.append({ type: 'turn_end', output: [{ type: 'text', content: 'legacy' }], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  expect(await store.listResults(identity.run.sessionId, 'owner', conversation)).toEqual([]);
});

it.each([
  [{ status: 'failed', code: 'same-code', retryable: false, deliveryUnknown: true }, 'unknown'],
  [{ status: 'failed', code: 'same-code', retryable: true }, 'not_sent'],
  [{ status: 'failed', code: 'partial_delivery', retryable: false, messages: [{ conversation, id: 'first' }, null] }, 'partial'],
  [{ status: 'failed', code: 'later-message-failed', retryable: false, deliveryPartial: true }, 'partial'],
  [{ status: 'sent', messages: [{ conversation, id: 'sent' }] }, 'sent'],
] as const)('records actual settlement %j without replacing its return value', async (outcome, status) => {
  const records: TurnDeliveryRecord[] = [];
  const send = vi.fn(async () => outcome as DeliveryOutcome);
  const port = recordFinalReply({ send }, identity, () => true, { recordDelivery: async record => { records.push(record); } }, vi.fn());
  expect(await port.send([])).toBe(outcome);
  expect(records[0]).toMatchObject({ status: 'unknown', phase: 'started' });
  expect(records.at(-1)?.status).toBe(status);
  if ('deliveryUnknown' in outcome) expect(records.at(-1)?.deliveryUnknown).toBe(outcome.deliveryUnknown);
  if ('messages' in outcome) expect(records.at(-1)?.messages).toEqual(outcome.messages);
  expect(send).toHaveBeenCalledOnce();
});

it('retains each terminal send, confirmed prefixes and public resource references without persisting media bytes', async () => {
  const store = new FileJournalStore(directory), journal = new PersistentTurnJournal(identity.run, store);
  await journal.append({ type: 'turn_end', output: [{ type: 'text', content: 'result' }], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  const port = recordFinalReply({ send: async () => ({ status: 'sent', messages: [{ conversation, id: 'sent' }] }) }, identity, () => true, store, vi.fn());
  await port.send([{ type: 'image', url: 'https://assets.example/image.png', base64: 'secret-image-bytes' }, { type: 'image', url: 'data:image/png;base64,private' }]);
  await port.send([{ type: 'message', segments: [{ type: 'audio', data: { media: { kind: 'url', value: 'https://assets.example/audio.mp3' } } }] }]);
  const [result] = await store.listResults(identity.run.sessionId, 'owner', conversation);
  expect(result?.deliveries).toHaveLength(2);
  expect(result?.deliveries.flatMap(receipt => receipt.resources)).toEqual([
    { type: 'image', url: 'https://assets.example/image.png' }, { type: 'audio', url: 'https://assets.example/audio.mp3' },
  ]);
  const runDirectory = join(directory, Buffer.from(identity.run.sessionId).toString('base64url'), Buffer.from(identity.run.turnId).toString('base64url'));
  const contents = await Promise.all((await readdir(runDirectory)).filter(name => name.endsWith('.delivery')).map(name => readFile(join(runDirectory, name), 'utf8')));
  expect(contents.join('')).not.toContain('secret-image-bytes'); expect(contents.join('')).not.toContain('data:image');
});

it('preserves thrown send identity and ignores receipt-store failure without retrying platform sends', async () => {
  const error = new Error('transport uncertain'), warn = vi.fn(), send = vi.fn(async () => { throw error; });
  const port = recordFinalReply({ send }, identity, () => true, { recordDelivery: async () => { throw Error('disk full'); } }, warn);
  await expect(port.send([])).rejects.toBe(error);
  expect(warn).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledOnce();
  const success = { status: 'sent' as const };
  const succeeded = recordFinalReply({ send: async () => success }, identity, () => true, { recordDelivery: async () => { throw Error('disk full'); } }, warn);
  expect(await succeeded.send([])).toBe(success);
  const brokenDiagnostics = recordFinalReply({ send: async () => success }, identity, () => true,
    { recordDelivery: async () => { throw Error('disk full'); } }, () => { throw Error('log transport failed'); });
  expect(await brokenDiagnostics.send([])).toBe(success);
});

it('recovers scoped completed output as unknown when the process stopped before entering its final reply', async () => {
  const store = new FileJournalStore(directory);
  const journal = new PersistentTurnJournal(identity.run, store, { subjectId: identity.subjectId, roles: [] }, () => identity.origin);
  await journal.append({ type: 'turn_end', output: [{ type: 'image', url: 'data:image/png;base64,cHJpdmF0ZQ==' },
    { type: 'text', content: 'finished' }], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  const [result] = await new FileJournalStore(directory).listResults(identity.run.sessionId, identity.subjectId, conversation);
  expect(result?.message).toContain('finished'); expect(result?.message).not.toContain('cHJpdmF0ZQ==');
  expect(result?.deliveries).toMatchObject([{ status: 'unknown', outcome: 'unrecorded', resources: [] }]);
  expect(await store.listResults(identity.run.sessionId, 'wrong-owner', conversation)).toEqual([]);
});

it('retains started-send uncertainty across restart and replaces only that attempt with its actual settlement', async () => {
  const store = new FileJournalStore(directory), journal = new PersistentTurnJournal(identity.run, store, { subjectId: identity.subjectId, roles: [] }, () => identity.origin);
  await journal.append({ type: 'turn_end', output: [{ type: 'text', content: 'finished' }], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  let resolve!: (value: DeliveryOutcome) => void;
  const send = vi.fn(() => new Promise<DeliveryOutcome>(done => { resolve = done; }));
  const port = recordFinalReply({ send }, identity, () => true, store, vi.fn());
  const pending = port.send([]);
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect((await new FileJournalStore(directory).listResults(identity.run.sessionId, identity.subjectId, conversation))[0]?.deliveries)
    .toMatchObject([{ status: 'unknown', outcome: 'pending' }]);
  resolve({ status: 'sent', messages: [{ conversation, id: 'native' }] }); await pending;
  const [result] = await store.listResults(identity.run.sessionId, identity.subjectId, conversation);
  expect(result?.deliveries).toHaveLength(1);
  expect(result?.deliveries[0]).toMatchObject({ status: 'sent', outcome: 'sent', messages: [{ id: 'native' }] });
});

it('pages fifty scoped completed runs with a stable tie-breaker and replays only the selected bodies once', async () => {
  const store = new FileJournalStore(directory);
  await Promise.all(Array.from({ length: 75 }, async (_, index) => {
    const run = { sessionId: identity.run.sessionId, turnId: `turn-${String(index).padStart(3, '0')}` };
    await store.recordRecoveryIdentity({ ...identity, run, subjectId: index < 55 ? identity.subjectId : 'other-owner' });
    await store.append({ version: 1, run, sequence: 1, timestamp: 90, type: 'message.completed', data: { message: run.turnId } }, 0);
    await store.append({ version: 1, run, sequence: 2, timestamp: 100, type: 'turn.completed', terminal: 'completed', data: {} }, 1);
  }));
  const replay = vi.spyOn(store, 'replay');
  const first = await store.readResultsPage(identity.run.sessionId, identity.subjectId, conversation);
  expect(first.results).toHaveLength(50); expect(first.hasMore).toBe(true);
  expect(first.nextCursor).toEqual({ completedAt: 100, turnId: 'turn-005' });
  expect(first.results[0]?.turnId).toBe('turn-005'); expect(first.results.at(-1)?.turnId).toBe('turn-054');
  expect(replay).toHaveBeenCalledTimes(50);
  const second = await store.readResultsPage(identity.run.sessionId, identity.subjectId, conversation, first.nextCursor!);
  expect(second.results.map(result => result.turnId)).toEqual(['turn-000', 'turn-001', 'turn-002', 'turn-003', 'turn-004']);
  expect(second.hasMore).toBe(false); expect(second.nextCursor).toBeNull();
  expect(replay).toHaveBeenCalledTimes(55);
});
