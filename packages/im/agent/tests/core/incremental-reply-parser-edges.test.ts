import { describe, expect, it } from 'vitest';
import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';
import { createLegacyStructuredReplyStreamParser, type StructuredReplyStreamCorpusCase } from './structured-reply-stream-baseline.js';

const mention = (value: string) => `{"messages":[{"segments":[{"type":"mention","data":{"target":${value}}},{"type":"text","data":{"text":" hello"}}]}]}`;
const text = (value: string) => `{"messages":[{"segments":[{"type":"text","data":{"text":${value}}}]}]}`;
const valid = text('"safe"');
const cases: readonly StructuredReplyStreamCorpusCase[] = [
  ...['-123', '-0', '0', '12.0', '12.5', '1e3', '1E+3', '1e-3', '-1.5e+3', '9007199254740992', '1e309'].map(value => ({ name: `numeric-mention-${value}`, raw: mention(value) })),
  ...['true', 'false', 'null', '12', '-12', '1.5', '1e2'].map(value => ({ name: `nonstring-text-${value}`, raw: text(value) })),
  { name: 'partial-true-root-reaction', raw: '{"reaction":true,"messages":[]}' },
  { name: 'partial-null-message-segments', raw: '{"messages":[{"segments":null}]}' },
  { name: 'partial-false-message', raw: '{"messages":[false]}' },
  { name: 'prototype-root-property', raw: '{"__proto__":{"messages":[]},"messages":[{"segments":[{"type":"text","data":{"text":"safe"}}]}]}' },
  { name: 'constructor-root-property', raw: '{"constructor":{"prototype":{"messages":[]}},"messages":[]}' },
  { name: 'prototype-segment-property', raw: '{"messages":[{"segments":[{"__proto__":{"type":"text"},"data":{"text":"safe"}}]}]}' },
  { name: 'constructor-message-property', raw: '{"messages":[{"constructor":{},"segments":[{"type":"text","data":{"text":"safe"}}]}]}' },
  { name: 'prototype-data-property', raw: '{"messages":[{"segments":[{"type":"text","data":{"__proto__":{},"text":"safe"}}]}]}' },
  { name: 'duplicate-prototype-property', raw: '{"__proto__":{},"__proto__":{},"messages":[]}' },
  ...['x', ' true', ' null', '\ntrailing', '{}', '[]', ',"reaction":""', '```'].map(tail => ({ name: `trailing-root-${JSON.stringify(tail)}`, raw: valid + tail })),
  { name: 'invalid-escape-then-valid-duplicate', raw: '{"messages":[{"segments":[{"type":"text","data":{"text":"bad\\q","text":"safe"}}]}]}' },
  { name: 'incomplete-unicode-escape', raw: text('"bad\\u12"') },
  { name: 'invalid-unicode-digit', raw: text('"bad\\u12XZ"') },
  { name: 'escaped-solidus-and-backslash', raw: text('"safe\\/path\\\\end"') },
  { name: 'escaped-quote-then-close', raw: text(JSON.stringify('safe" end')) },
  { name: 'raw-tab-in-string', raw: text('"bad\ttab"') },
  { name: 'raw-newline-in-string', raw: text('"bad\nline"') },
  { name: 'escaped-messages-and-text-key', raw: '{"\\u006dessages":[{"segments":[{"type":"text","data":{"\\u0074ext":"safe"}}]}]}' },
  { name: 'escaped-duplicate-messages-key', raw: '{"messages":[],"mes\\u0073ages":[{"segments":[{"type":"text","data":{"text":"last"}}]}]}' },
  { name: 'escaped-prototype-key', raw: '{"\\u005f_proto__":{},"messages":[]}' },
  { name: 'fenced-json', raw: '```json\n' + valid + '\n```' },
  { name: 'plain-preface-before-json', raw: 'Here is the answer: ' + valid },
  { name: 'plain-text', raw: 'ordinary text without JSON' },
  { name: 'json-string-root', raw: JSON.stringify(valid) },
  { name: 'null-root', raw: 'null' },
  { name: 'empty-input', raw: '' },
];

async function outcome<T>(read: () => Promise<T>) {
  try { return { status: 'resolved' as const, value: await read() }; }
  catch (error) { return { status: 'rejected' as const, name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error) }; }
}

function boundaries(length: number, seed?: number): number[] {
  if (seed === undefined) return Array.from({ length: length + 1 }, (_, index) => index);
  const result = [0];
  let end = 0, state = seed >>> 0;
  while (end < length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    end = Math.min(length, end + 1 + state % 17);
    result.push(end);
  }
  return result;
}

const schedules = [undefined, 1, 0x5eed, 0xdeadbeef] as const;
describe.each(schedules)('incremental parser edge compatibility (seed=%s)', seed => {
  it.each(cases)('$name matches the frozen oracle at each offered prefix', async item => {
    const legacy = createLegacyStructuredReplyStreamParser(item.profile), parser = createStructuredReplyStreamParser(item.profile);
    let previous = 0;
    for (const end of boundaries(item.raw.length, seed)) {
      parser.append(item.raw.slice(previous, end)); previous = end;
      const expected = await outcome(() => legacy.parse(item.raw.slice(0, end), end));
      const actual = await outcome(() => parser.snapshot(end));
      expect(actual, `${item.name}; seed=${seed}; end=${end}; raw=${JSON.stringify(item.raw.slice(0, end))}`).toEqual(expected);
    }
  });
});

it.each(cases)('$name keeps the final decoder outcome after incremental input', async item => {
  const legacy = createLegacyStructuredReplyStreamParser(item.profile), parser = createStructuredReplyStreamParser(item.profile);
  let previous = 0;
  for (const end of boundaries(item.raw.length, 0x5eed)) {
    parser.append(item.raw.slice(previous, end)); previous = end;
    await outcome(() => parser.snapshot(end));
  }
  expect(await outcome(() => parser.finish(item.raw, item.raw.length + 1)))
    .toEqual(await outcome(() => legacy.parse(item.raw, item.raw.length + 1, true)));
});
