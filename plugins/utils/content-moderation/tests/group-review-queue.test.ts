import { PluginStateStore, rootPluginId, type StateRecord, aiCompletionToken, databaseHostToken, outboundHostToken,
  type AiCompletionInput } from 'zhin.js';
import { SnapshotStore, createGenerationAdmissionGate, generationAdmissionSource } from 'zhin.js/plugin-runtime';
import { adapterFeatureId } from 'zhin.js/adapter';
import type { Locale } from 'zhin.js/i18n';
import inbound from '../middlewares/inbound/index.ts';
import { ModerationEngine } from '../src/engine.js';
import { moderationEngineToken } from '../src/runtime.js';
import { takeGroupBatch } from '../src/group-review-batch.js';

const NOW = Date.UTC(2026, 9, 23, 12);
const advertising = '联系我购买这个产品';
type BatchMessage = { id: string; batchId: string; sender: string; text: string; sequence: number; preceding: number[] };
const payload = (input: AiCompletionInput) => JSON.parse(input.untrusted![0]!.text) as {
  messages: BatchMessage[]; context: { sequence: number; sender: string; text: string }[];
  batches: { id: string; messages: string[] }[];
};
function answer(input: AiCompletionInput, recall = false) {
  return { model: 'fixture', durationMs: 0, text: JSON.stringify({ reviews: payload(input).messages.map(item => ({
    id: item.id, batchId: item.batchId, category: item.text.includes(advertising) ? 'advertising' : 'none',
    evidence: [item.text], recall, recallReason: '保留上下文',
  })) }) };
}
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });

function fixture(legacyRecall = false) {
  const rows = new Map<string, StateRecord>(); let revision = 0; let conflicts = 0;
  const state = new PluginStateStore(rootPluginId(), {
    read: async (_owner, _scope, key) => rows.get(key),
    compareExchange: async (_owner, _scope, key, expected, value, expiresAt) => {
      if (rows.get(key)?.revision !== expected) { conflicts++; return false; }
      if (value === undefined) rows.delete(key);
      else rows.set(key, { revision: String(++revision), value, expiresAt });
      return true;
    },
  });
  const config = { groupModeration: [{ adapter: 'icqq', endpoint: '8596238', account: '8596238', group: '129043431' }],
    sources: [{ id: 'fixture', type: 'local', includeBuiltin: false,
      words: legacyRecall ? [{ word: advertising, severity: 'critical' }] : [] }] };
  const engine = new ModerationEngine(); engine.configure(config);
  const completeText = vi.fn(async (input: AiCompletionInput) => answer(input));
  const inspectGroupMember = vi.fn(async () => ({ canModerate: true, joinedAt: NOW - 3600_000 }));
  const moderateGroupMember = vi.fn(async () => {});
  const sendTarget = vi.fn(async () => 'notice-id');
  const recall = vi.fn(async () => {});
  const endpoint = { identity: { adapter: 'icqq', id: 'canonical:8596238' }, selfUserId: '8596238',
    management: { inspectGroupMember, moderateGroupMember } };
  const gate = createGenerationAdmissionGate();
  const client = {};
  const adapters = { connection: () => endpoint, [generationAdmissionSource]: [gate],
    management: () => endpoint.management,
    acquire: (id: string, signal: AbortSignal, source: unknown) => {
      if (id !== endpoint.identity.id || source !== client) throw new Error('Wrong fixture Endpoint source');
      signal.throwIfAborted(); let released = false;
      return { signal, release: () => { released = true; }, assertActive: () => {
        signal.throwIfAborted(); if (released) throw new Error('Fixture Endpoint lease released');
      } };
    },
  };
  const resources = new Map<string, unknown>([
    [moderationEngineToken.id, engine], [aiCompletionToken.id, { supportsUsageShares: true, completeText }],
    [databaseHostToken.id, { state: { forConversation: () => state } }],
    [outboundHostToken.id, { sendTarget, recall }],
  ]);
  const snapshot = () => ({ root: rootPluginId(), tree: new Map(), config: new Map(), capabilities: new Map(),
    resources: new Map([[rootPluginId(), resources as never]]), projections: new Map([[adapterFeatureId, adapters]]) });
  const disposed = vi.fn();
  const snapshots = new SnapshotStore({ ...snapshot(), resources: new Map(), projections: new Map() });
  snapshots.commit(0, { snapshot: snapshot(), dispose: disposed });
  const message = { endpointId: '8596238', id: 'original', sender: { id: '123' }, locale: 'zh-CN' as Locale,
    conversation: { endpoint: { adapter: 'icqq', id: 'canonical:8596238' }, kind: 'group', id: '129043431' },
    content: advertising, segments: [], metadata: { platformSentAt: NOW },
    $reply: vi.fn(async () => { throw new Error('Original Message reply expired'); }) };
  const abort = new AbortController(); const next = vi.fn(async () => undefined);
  const run = (input = message, signal = abort.signal) => inbound.handle({ config, input, signal, $client: client,
    use: (token: { id: string }) => { if (!resources.has(token.id)) throw new Error('Missing resource'); return resources.get(token.id); },
    project: () => adapters } as never, next as never);
  const flush = () => vi.advanceTimersByTimeAsync(300);
  const runAndFlush = async (input = message) => { const done = run(input); await flush(); await done; };
  cleanups.push(async () => { engine.groupReviewQueue.stop(); await snapshots.close(); });
  return { rows, config, engine, completeText, inspectGroupMember, moderateGroupMember, sendTarget, recall, endpoint,
    resources, snapshots, snapshot, adapters, disposed, get conflicts() { return conflicts; }, message, abort, next, run, flush, runAndFlush };
}

describe('group review queue and inbound delivery', () => {
  it('continues ordinary dispatch before the collector or model finishes, then sends through the owned host', async () => {
    const f = fixture(); const result = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => result.promise);
    await f.run(); expect(f.next).toHaveBeenCalledOnce(); expect(f.completeText).not.toHaveBeenCalled();
    await f.flush(); expect(f.completeText).toHaveBeenCalledOnce(); expect(f.sendTarget).not.toHaveBeenCalled();
    result.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.message.$reply).not.toHaveBeenCalled();
    expect(f.sendTarget).toHaveBeenCalledWith(expect.objectContaining({ id: '129043431' }), [
      { type: 'mention', data: { target: '123' } },
      { type: 'text', data: { text: ' 提醒。请勿发布未经请求的广告或引流信息。' } },
    ], { locale: 'zh-CN' });
  });

  it('pins each message language across queued review and owned host delivery', async () => {
    const f = fixture(); const result = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => result.promise);
    const english = { ...f.message, locale: 'en' as Locale, metadata: { ...f.message.metadata, locale: 'zh-CN' } };
    await f.run(english);
    await f.run({ ...f.message, id: 'chinese', sender: { id: '456' } });
    await f.flush();
    english.locale = 'zh-CN';
    f.message.locale = 'en';
    result.resolve(answer(f.completeText.mock.calls[0]![0]));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.sendTarget).toHaveBeenCalledTimes(2);
    expect(f.sendTarget).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: '129043431' }), [
      { type: 'mention', data: { target: '123' } },
      { type: 'text', data: { text: ' Reminder. Do not post unsolicited advertising or promotional invitations.' } },
    ], { locale: 'en' });
    expect(f.sendTarget).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: '129043431' }), [
      { type: 'mention', data: { target: '456' } },
      { type: 'text', data: { text: ' 提醒。请勿发布未经请求的广告或引流信息。' } },
    ], { locale: 'zh-CN' });
    expect(payload(f.completeText.mock.calls[0]![0]).messages.map(item => item.text)).toEqual([advertising, advertising]);
    expect(f.message.$reply).not.toHaveBeenCalled();
  });

  it('groups by user without reordering the shared conversation or escalating old messages', async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) await f.run({ ...f.message, id: `m${n}`, sender: { id: n % 2 ? 'b' : 'a' } });
    await f.flush(); expect(f.completeText).toHaveBeenCalledOnce();
    const request = payload(f.completeText.mock.calls[0]![0]);
    expect(request.batches.map(batch => batch.messages)).toEqual([['0', '2'], ['1', '3']]);
    expect(request.messages.map(item => item.sender)).toEqual(['a', 'b', 'a', 'b']);
    expect(request.messages[0]!.preceding).toEqual([]);
    expect(request.messages[2]!.preceding).toEqual([request.messages[0]!.sequence, request.messages[1]!.sequence]);
    expect(f.sendTarget).toHaveBeenCalledTimes(2);
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('uses the same scene buffer for equivalent addresses with different property order', async () => {
    const f = fixture(); await f.run({ ...f.message, content: 'first' });
    await f.run({ ...f.message, id: 'second', content: 'second', conversation: {
      id: f.message.conversation.id, kind: 'group', endpoint: {
        id: f.message.conversation.endpoint.id, adapter: f.message.conversation.endpoint.adapter,
      },
    } });
    await f.flush(); expect(f.completeText).toHaveBeenCalledOnce();
    const request = payload(f.completeText.mock.calls[0]![0]);
    expect(request.messages.map(item => item.text)).toEqual(['first', 'second']);
    expect(request.messages[1]!.preceding).toEqual([request.messages[0]!.sequence]);
  });

  it('uses a snapshot of message identity after ordinary dispatch returns', async () => {
    const f = fixture(); await f.run();
    f.message.sender.id = 'victim'; f.message.conversation.id = 'other-group'; f.message.id = 'other-message'; f.message.content = 'changed';
    await f.flush();
    expect(payload(f.completeText.mock.calls[0]![0]).messages[0]).toMatchObject({ sender: '123', text: advertising });
    expect(f.sendTarget).toHaveBeenCalledWith(expect.objectContaining({ id: '129043431' }), expect.arrayContaining([
      { type: 'mention', data: { target: '123' } },
    ]), { locale: 'zh-CN' });
  });

  it('matches reordered verdicts to original IDs and rejects cross-message evidence', async () => {
    const f = fixture();
    f.completeText.mockImplementation(async input => {
      const messages = payload(input).messages;
      return { ...answer(input), text: JSON.stringify({ reviews: messages.map(item => ({
        id: item.id, batchId: item.batchId, category: 'advertising', evidence: [advertising], recall: false, recallReason: '保留上下文',
      })).reverse() }) };
    });
    await f.run({ ...f.message, sender: { id: 'a' } });
    await f.run({ ...f.message, id: 'second', sender: { id: 'b' }, content: 'ordinary question' });
    await f.flush();
    expect(f.sendTarget).toHaveBeenCalledOnce();
    expect(f.sendTarget.mock.calls[0]![1]).toEqual(expect.arrayContaining([{ type: 'mention', data: { target: 'a' } }]));
  });

  it('rejects duplicated or missing verdict IDs without discarding other valid results', async () => {
    const f = fixture();
    f.completeText.mockImplementation(async input => {
      const result = answer(input); const reviews = JSON.parse(result.text).reviews;
      return { ...result, text: JSON.stringify({ reviews: [reviews[0], reviews[0], reviews[2], { ...reviews[1], id: 'unknown' }] }) };
    });
    for (const id of ['a', 'b', 'c']) await f.run({ ...f.message, id, sender: { id } });
    await f.flush();
    expect(f.sendTarget).toHaveBeenCalledOnce();
    expect(f.sendTarget.mock.calls[0]![1]).toEqual(expect.arrayContaining([{ type: 'mention', data: { target: 'c' } }]));
  });

  it('rebuilds a shared request without over-quota users and continues for other users', async () => {
    const f = fixture();
    f.completeText.mockRejectedValueOnce(Object.assign(new Error('quota'), {
      name: 'AiCompletionQuotaError', scope: 'user', retryAfterSeconds: 10, deniedUserIds: ['a'],
    }));
    for (const id of ['a', 'b']) await f.run({ ...f.message, id, sender: { id } });
    await f.flush();
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(payload(f.completeText.mock.calls[1]![0]).messages.map(item => item.sender)).toEqual(['b']);
    expect(f.completeText.mock.calls[1]![0].usageShares?.map(share => share.subject.userId)).toEqual(['b']);
    expect(f.sendTarget).toHaveBeenCalledOnce();
  });

  it('removes a cancelled participant before resubmitting after quota preflight', async () => {
    const f = fixture(); const cancelB = new AbortController();
    f.completeText.mockImplementationOnce(async () => {
      cancelB.abort();
      throw Object.assign(new Error('quota'), { name: 'AiCompletionQuotaError', scope: 'user', retryAfterSeconds: 10, deniedUserIds: ['a'] });
    });
    await f.run({ ...f.message, id: 'a', sender: { id: 'a' } });
    await f.run({ ...f.message, id: 'b', sender: { id: 'b' } }, cancelB.signal);
    await f.flush(); expect(f.completeText).toHaveBeenCalledOnce(); expect(f.sendTarget).not.toHaveBeenCalled();
  });

  it('cancels one in-flight participant without cancelling the others', async () => {
    const f = fixture(); const cancelB = new AbortController();
    f.completeText.mockImplementationOnce(async input => {
      cancelB.abort(); expect(input.signal?.aborted).toBe(false); return answer(input);
    });
    await f.run({ ...f.message, id: 'a', sender: { id: 'a' } });
    await f.run({ ...f.message, id: 'b', sender: { id: 'b' } }, cancelB.signal);
    await f.flush(); expect(f.sendTarget).toHaveBeenCalledOnce();
    expect(f.sendTarget.mock.calls[0]![1]).toEqual(expect.arrayContaining([{ type: 'mention', data: { target: 'a' } }]));
  });

  it('aborts a retired adapter request and drains new messages when the queue resource is retained', async () => {
    const f = fixture(); let firstSignal: AbortSignal | undefined;
    f.completeText.mockImplementationOnce(input => new Promise((_resolve, reject) => {
      firstSignal = input.signal;
      input.signal!.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
    }));
    await f.run(); await f.flush();
    const nextAdapters = { ...f.adapters, [generationAdmissionSource]: [createGenerationAdmissionGate()] };
    f.snapshots.commit(1, { snapshot: { ...f.snapshot(), projections: new Map([[adapterFeatureId, nextAdapters]]) }, dispose: () => {} });
    expect(firstSignal?.aborted).toBe(true);
    // The fixture's projection now exposes the replacement adapter gate to the next inbound operation.
    f.adapters[generationAdmissionSource] = nextAdapters[generationAdmissionSource];
    await f.run({ ...f.message, id: 'replacement', content: 'new adapter message' });
    await f.flush();
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(payload(f.completeText.mock.calls[1]![0]).messages.map(item => item.text)).toEqual(['new adapter message']);
    expect(f.sendTarget).not.toHaveBeenCalled();
  });

  it('releases a retired snapshot after its batch even when the retained queue remains busy', async () => {
    const f = fixture();
    const first = Promise.withResolvers<ReturnType<typeof answer>>();
    const second = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await f.run({ ...f.message, content: 'old generation' }); await f.flush();
    f.snapshots.commit(1, { snapshot: f.snapshot(), dispose: () => {} });
    await f.run({ ...f.message, id: 'new', content: 'new generation' });
    expect(f.disposed).not.toHaveBeenCalled();
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(f.disposed).toHaveBeenCalledOnce();
    second.resolve(answer(f.completeText.mock.calls[1]![0])); await vi.advanceTimersByTimeAsync(0);
  });

  it.each(['provider failure', 'truncated result'])('keeps chat responsive and releases the queue after %s', async kind => {
    const f = fixture();
    if (kind === 'provider failure') f.completeText.mockRejectedValueOnce(new Error('unavailable'));
    else f.completeText.mockResolvedValueOnce({ model: 'fixture', durationMs: 0, text: '{"reviews":[' });
    await f.runAndFlush(); expect(f.next).toHaveBeenCalledOnce(); expect(f.sendTarget).not.toHaveBeenCalled();
    await f.runAndFlush({ ...f.message, id: 'later' }); expect(f.sendTarget).toHaveBeenCalledOnce();
  });

  it('keeps collecting during a request and drains immediately afterward in batches of up to 32 originals', async () => {
    const f = fixture(); const first = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => first.promise);
    await f.run({ ...f.message, content: 'normal' }); await f.flush();
    for (let n = 0; n < 33; n++) await f.run({ ...f.message, id: `m${n}`, content: `normal ${n}`, sender: { id: String(Math.floor(n / 4)) } });
    expect(f.completeText).toHaveBeenCalledOnce();
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.completeText).toHaveBeenCalledTimes(3);
    expect(f.completeText.mock.calls.slice(1).map(([input]) => payload(input).messages.length)).toEqual([32, 1]);
  });

  it('starts at eight user batches without waiting the rest of the idle window', async () => {
    const f = fixture();
    for (let n = 0; n < 8; n++) await f.run({ ...f.message, id: `m${n}`, sender: { id: String(n) }, content: 'hello' });
    await vi.advanceTimersByTimeAsync(0); expect(f.completeText).toHaveBeenCalledOnce();
  });

  it('prepares a full same-user request without CAS contention or overriding the model output budget', async () => {
    const f = fixture(); const first = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementation(async input => {
      if ((input.maxTokens ?? 8192) > 8192) throw new Error('Requested output exceeds configured model limit');
      return answer(input);
    });
    f.completeText.mockImplementationOnce(() => first.promise);
    await f.run({ ...f.message, content: 'first' }); await f.flush();
    for (let n = 0; n < 32; n++) await f.run({ ...f.message, id: `m${n}`, content: `${advertising} ${n}` });
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(payload(f.completeText.mock.calls[1]![0]).messages).toHaveLength(32);
    expect(f.conflicts).toBe(0);
    expect(f.sendTarget).toHaveBeenCalledOnce();
  });

  it('does not reset the idle deadline when more messages arrive', async () => {
    const f = fixture();
    await f.run({ ...f.message, content: 'first' });
    await vi.advanceTimersByTimeAsync(250);
    await f.run({ ...f.message, id: 'second', content: 'second' });
    await vi.advanceTimersByTimeAsync(49); expect(f.completeText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.completeText).toHaveBeenCalledOnce();
    expect(payload(f.completeText.mock.calls[0]![0]).messages).toHaveLength(2);
  });

  it.each([false, true])('retains model recall ownership when legacy rules request deletion: %s', async choice => {
    const f = fixture(true); f.completeText.mockImplementation(async input => answer(input, choice));
    const done = f.run(); await vi.advanceTimersByTimeAsync(299);
    expect(f.recall).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await done;
    expect(f.recall).toHaveBeenCalledTimes(choice ? 1 : 0);
    expect(f.sendTarget).toHaveBeenCalledOnce();
  });

  it('falls back to legacy recall only when the model did not establish a violation', async () => {
    const f = fixture(true);
    f.completeText.mockImplementation(async input => ({ ...answer(input), text: JSON.stringify({ reviews: payload(input).messages
      .map(item => ({ id: item.id, batchId: item.batchId, category: 'none' })) }) }));
    await f.runAndFlush(); expect(f.sendTarget).not.toHaveBeenCalled(); expect(f.recall).toHaveBeenCalledOnce();
  });

  it('keeps a pending original safe from duplicate legacy recall', async () => {
    const f = fixture(true); const result = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => result.promise);
    const first = f.run(); await f.flush(); const duplicate = f.run();
    expect(f.recall).not.toHaveBeenCalled(); result.resolve(answer(f.completeText.mock.calls[0]![0]));
    await vi.advanceTimersByTimeAsync(0); await Promise.all([first, duplicate]);
    expect(f.completeText).toHaveBeenCalledOnce(); expect(f.recall).not.toHaveBeenCalled();
  });

  it.each(['account', 'group', 'endpoint', 'canonical'])('does not enqueue a different %s', async field => {
    const f = fixture();
    if (field === 'account') f.endpoint.selfUserId = 'another';
    if (field === 'group') f.message.conversation.id = 'another';
    if (field === 'endpoint') f.message.endpointId = 'another';
    if (field === 'canonical') f.endpoint.identity.id = 'another';
    await f.runAndFlush(); expect(f.completeText).not.toHaveBeenCalled(); expect(f.sendTarget).not.toHaveBeenCalled();
  });

  it('rechecks account identity after the model resolves', async () => {
    const f = fixture(); f.completeText.mockImplementation(async input => { f.endpoint.selfUserId = 'another'; return answer(input); });
    await f.runAndFlush(); expect(f.sendTarget).not.toHaveBeenCalled(); expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not advance after an unconfirmed notice and keeps the recall decision', async () => {
    const f = fixture(true); f.sendTarget.mockResolvedValue('');
    await f.runAndFlush(); vi.setSystemTime(NOW + 2000);
    await f.runAndFlush({ ...f.message, id: 'm2', metadata: { platformSentAt: Date.now() } });
    expect(f.sendTarget).toHaveBeenCalledOnce(); expect(f.recall).not.toHaveBeenCalled();
  });

  it('skips a new model review at the count limit and resumes admission after draining', async () => {
    const f = fixture(); const first = Promise.withResolvers<ReturnType<typeof answer>>();
    const enqueue = f.engine.groupReviewQueue.enqueue.bind(f.engine.groupReviewQueue);
    const audit = vi.fn();
    vi.spyOn(f.engine.groupReviewQueue, 'enqueue').mockImplementation(input => enqueue({ ...input, audit }));
    f.completeText.mockImplementationOnce(() => first.promise);
    await f.run({ ...f.message, content: 'first' }); await f.flush();
    for (let n = 0; n < 128; n++) await f.run({ ...f.message, id: `m${n}`, content: 'normal' });
    await f.run({ ...f.message, id: 'overflow', content: 'skipped' });
    expect(f.next).toHaveBeenCalledTimes(130);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'group_review_skipped', messageId: 'overflow', reason: 'queue_full' }));
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.completeText.mock.calls.flatMap(([input]) => payload(input).messages).map(item => item.text)).not.toContain('skipped');
    await f.runAndFlush({ ...f.message, id: 'after-drain', content: 'after drain' });
    expect(payload(f.completeText.mock.calls.at(-1)![0]).messages[0]!.text).toBe('after drain');
  });

  it('applies the byte limit independently of the message count', async () => {
    const f = fixture(); const first = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => first.promise);
    await f.run({ ...f.message, content: 'first' }); await f.flush();
    const long = '中'.repeat(12000); // 36,000 UTF-8 bytes; seven fit, eight exceed 256 KiB.
    for (let n = 0; n < 7; n++) await f.run({ ...f.message, id: `m${n}`, content: long });
    await f.run({ ...f.message, id: 'overflow', content: long });
    await f.run({ ...f.message, id: 'later', content: 'small' });
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.completeText.mock.calls.flatMap(([input]) => payload(input).messages.map(item => item.sequence))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
  });

  it('keeps pending recall ownership at capacity while still applying lexicon rules to new skipped messages', async () => {
    const f = fixture(true); const first = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => first.promise);
    const original = f.run(); await f.flush();
    for (let n = 0; n < 128; n++) await f.run({ ...f.message, id: `m${n}`, content: 'normal' });
    await f.run(); // Duplicate of the in-flight original must not fall through to lexicon recall.
    expect(f.recall).not.toHaveBeenCalled();
    await f.run({ ...f.message, id: 'skipped' });
    expect(f.recall).toHaveBeenCalledOnce();
    expect(f.recall).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ id: 'skipped' }) }));
    first.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0); await original;
    expect(f.recall).toHaveBeenCalledOnce();
  });

  it('preserves persisted recall ownership when a reviewed original is redelivered to a full queue', async () => {
    const f = fixture(true); await f.runAndFlush(); // The model explicitly kept the original.
    const running = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => running.promise);
    await f.run({ ...f.message, id: 'running', content: 'normal' }); await f.flush();
    for (let n = 0; n < 128; n++) await f.run({ ...f.message, id: `m${n}`, content: 'normal' });
    await f.run(); expect(f.recall).not.toHaveBeenCalled();
    running.resolve(answer(f.completeText.mock.calls[1]![0])); await vi.advanceTimersByTimeAsync(0);
    expect(f.recall).not.toHaveBeenCalled();
  });

  it('does not share a request across different completion resources', async () => {
    const f = fixture();
    await f.run({ ...f.message, content: 'first service' });
    const other = vi.fn(async (input: AiCompletionInput) => answer(input));
    f.resources.set(aiCompletionToken.id, { supportsUsageShares: true, completeText: other });
    await f.run({ ...f.message, id: 'second', content: 'second service' });
    await f.flush();
    expect(f.completeText).toHaveBeenCalledOnce(); expect(other).toHaveBeenCalledOnce();
    expect(payload(f.completeText.mock.calls[0]![0]).messages.map(item => item.text)).toEqual(['first service']);
    expect(payload(other.mock.calls[0]![0]).messages.map(item => item.text)).toEqual(['second service']);
  });

  it('uses the original per-user completion contract when the host cannot attribute shared usage', async () => {
    const f = fixture(); f.resources.set(aiCompletionToken.id, { completeText: f.completeText });
    f.completeText.mockResolvedValue({ text: '{"category":"none"}', model: 'old-host', durationMs: 0 });
    for (const id of ['a', 'b']) await f.run({ ...f.message, id, sender: { id } });
    await f.flush(); expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(f.completeText.mock.calls.map(([input]) => input.onBehalfOf?.userId)).toEqual(['a', 'b']);
    expect(f.completeText.mock.calls.every(([input]) => input.usageShares === undefined)).toBe(true);
  });

  it('cancels queued and in-flight effects when the owning snapshot retires', async () => {
    const f = fixture(); const result = Promise.withResolvers<ReturnType<typeof answer>>();
    f.completeText.mockImplementationOnce(() => result.promise);
    await f.run(); await f.flush(); await f.run({ ...f.message, id: 'queued' });
    const closing = f.snapshots.close();
    result.resolve(answer(f.completeText.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0); await closing;
    expect(f.sendTarget).not.toHaveBeenCalled(); expect(f.moderateGroupMember).not.toHaveBeenCalled();
    expect(f.completeText).toHaveBeenCalledOnce();
  });
});

it('takes only a contiguous FIFO prefix when the ninth user batch is encountered', () => {
  const pending = Array.from({ length: 9 }, (_, n) => ({ sender: String(n), n }));
  pending.push({ sender: '0', n: 9 });
  expect(takeGroupBatch(pending).flat().map(item => item.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});
