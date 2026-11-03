import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';
import { ReplyJsonCandidate } from '../../src/outbound/reply-json-candidate.js';
import { createLegacyStructuredReplyStreamParser, structuredReplyStreamCorpus } from './structured-reply-stream-baseline.js';

it.each(structuredReplyStreamCorpus)('matches the frozen parser at every UTF-16 prefix: $name', async ({ raw, profile }) => {
  const candidate = createStructuredReplyStreamParser(profile);
  const old = createLegacyStructuredReplyStreamParser(profile);
  for (let end = 0; end <= raw.length; end++) {
    if (end) candidate.append(raw[end - 1]!);
    expect(await candidate.snapshot(end), `prefix ${end}: ${raw.slice(0, end)}`)
      .toEqual(await old.parse(raw.slice(0, end), end));
  }
  const result = async (run: () => Promise<unknown>) => {
    try { return { value: await run() }; } catch (error) { return { error: String(error) }; }
  };
  expect(await result(() => candidate.finish(raw, raw.length + 1)))
    .toEqual(await result(() => old.parse(raw, raw.length + 1, true)));
});

it.each(structuredReplyStreamCorpus)('keeps the same projection across seeded chunk boundaries: $name', async ({ raw, profile }) => {
  for (const seed of [1, 0x5eed, 0xdeadbeef]) {
    const candidate = createStructuredReplyStreamParser(profile), old = createLegacyStructuredReplyStreamParser(profile);
    let offset = 0, random = seed;
    while (offset < raw.length) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const end = Math.min(raw.length, offset + 1 + random % 17);
      candidate.append(raw.slice(offset, end)); offset = end;
      expect(await candidate.snapshot(end), `seed ${seed}, prefix ${end}`).toEqual(await old.parse(raw.slice(0, end), end));
    }
  }
});

it('scans only new standard-prefix characters and does not materialize a reaction-withheld body', () => {
  const cursor = new ReplyJsonCandidate();
  const header = '{"reaction":"ok","messages":[{"segments":[{"type":"text","data":{"text":"';
  cursor.append(header);
  expect(cursor.reaction()).toBe('ok');
  const before = cursor.work;
  for (let index = 0; index < 1200; index++) {
    cursor.append('x'.repeat(64));
    expect(cursor.reaction()).toBe('ok');
    expect(cursor.closedReaction).toBe('ok');
  }
  expect(cursor.fallback).toBe(false);
  expect(cursor.work.scannedCharacters - before.scannedCharacters).toBe(1200 * 64);
  expect(cursor.work.materializedNodes).toBe(before.materializedNodes);
});

it('reuses unchanged closed nodes and leaves already observed snapshots immutable', () => {
  const cursor = new ReplyJsonCandidate();
  const firstMessage = '{"segments":[{"type":"text","data":{"text":"closed"}}]}';
  cursor.append(`{"messages":[${firstMessage},{"segments":[{"type":"text","data":{"text":"first`);
  const before = cursor.value() as { messages: { segments: { data: { text: string } }[] }[] };
  cursor.append(' second');
  const after = cursor.value() as typeof before;
  expect(after.messages[0]).toBe(before.messages[0]);
  expect(before.messages[1]?.segments[0]?.data.text).toBe('first');
  expect(after.messages[1]?.segments[0]?.data.text).toBe('first second');
});

it('does not fragment a large single provider delta into per-character string allocations', () => {
  const cursor = new ReplyJsonCandidate();
  cursor.append('{"messages":[{"segments":[{"type":"text","data":{"text":"');
  const before = cursor.work;
  const text = 'x'.repeat(1024 * 1024);
  cursor.append(text);
  expect(cursor.work.scannedCharacters - before.scannedCharacters).toBe(text.length);
  expect(cursor.work.stringFragments - before.stringFragments).toBe(1);
  expect(cursor.value()).toEqual({ messages: [{ segments: [{ type: 'text', data: { text } }] }] });
});

it('keeps numeric-repair snapshot evidence scoped to its captured prefix while later input resumes the cursor', async () => {
  const profile = { types: ['text'] as const, reaction: { values: [{ value: 'ok', label: 'OK' }] } };
  const raw = '{"reaction":"","messages":[{"segments":[{"type":"text","data":{"text":"candidate"}}]}],"reaction":-';
  const candidate = createStructuredReplyStreamParser(profile);
  candidate.append(raw);
  const pending = candidate.snapshot(1);
  candidate.append('1,"reaction":""}');
  expect(await pending).toEqual(await createLegacyStructuredReplyStreamParser(profile).parse(raw, 1));
  expect(await pending).toBeUndefined();
  expect((await candidate.snapshot(2))?.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'candidate' } });
});

it.each([false, true])('keeps deeply nested non-message candidates non-public without recursion failure (split=%s)', async split => {
  const header = '{"messages":' + '['.repeat(12000), raw = header + '"x';
  const candidate = createStructuredReplyStreamParser();
  if (split) { candidate.append(header); candidate.append('"x'); } else candidate.append(raw);
  expect(await candidate.snapshot(1)).toEqual(await createLegacyStructuredReplyStreamParser().parse(raw, 1));
});
