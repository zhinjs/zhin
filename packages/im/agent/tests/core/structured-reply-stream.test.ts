import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';

const textStart = '{"messages":[{"segments":[{"type":"text","data":{"text":"';
const markdownStart = '{"messages":[{"segments":[{"type":"markdown","data":{"content":"';

it.each([
  '{"messages":[{"segments":[{"type":"bogus","data":{}},{"type":"text","data":{"text":"later',
  '{"messages":[{"segments":[{"type":"text","data":{"text":"first"}},{"type":"bogus","data":{}}]},{"segments":[{"type":"text","data":{"text":"later',
])('rejects a closed invalid segment instead of publishing around it', async raw => {
  expect(await createStructuredReplyStreamParser().parse(raw, 1)).toBeUndefined();
});

it('projects text while its JSON string is still open, with host-owned stable keys', async () => {
  const parser = createStructuredReplyStreamParser();
  const first = await parser.parse(textStart + 'first', 1);
  const second = await parser.parse(textStart + 'first second', 2);
  expect(first).toEqual({ revision: 1, messages: [{ key: 'message-0', complete: false,
    segments: [{ key: 'segment-0', complete: false, value: { type: 'text', data: { text: 'first' } } }],
  }] });
  expect(second?.messages[0]?.segments[0]).toEqual({ key: 'segment-0', complete: false,
    value: { type: 'text', data: { text: 'first second' } } });
});

it('decodes Markdown escapes without exposing JSON quotes, field names or surrogate fragments', async () => {
  const parser = createStructuredReplyStreamParser();
  const result = await parser.parse(markdownStart + '```ts\\nconst s = \\"hello', 1);
  expect(result?.messages[0]?.segments[0]?.value).toEqual({ type: 'markdown', data: { content: '```ts\nconst s = "hello' } });
  const dangling = await parser.parse(textStart + '\\uD83D', 2);
  expect(dangling?.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: '' } });
});

it('does not complete media until a following segment appears or the whole object is valid', async () => {
  const parser = createStructuredReplyStreamParser();
  const image = { type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/image.png' } } };
  const start = '{"messages":[{"segments":[' + JSON.stringify(image);
  const pending = await parser.parse(start, 1);
  expect(pending?.messages[0]?.segments[0]?.complete).toBe(false);
  const following = await parser.parse(start + ',{"type":"text","data":{"text":"after', 2);
  expect(following?.messages[0]?.segments[0]).toMatchObject({ complete: true, value: image });
  expect(following?.messages[0]?.segments[1]?.complete).toBe(false);
  const final = await parser.parse(start + ']}]}', 3, true);
  expect(final?.messages[0]).toMatchObject({ complete: true, segments: [{ complete: true, value: image }] });
});

it('waits for complete keyboard data and keeps incomplete atomic segments uncommitted', async () => {
  const parser = createStructuredReplyStreamParser();
  const partial = '{"messages":[{"segments":[{"type":"keyboard","data":{"rows":[[{"label":"Ready","payload":"run';
  const snapshot = await parser.parse(partial, 1);
  expect(snapshot?.messages[0]?.segments.every(segment => !segment.complete)).toBe(true);
});

it('enforces the selected profile on candidates and full final replies', async () => {
  const parser = createStructuredReplyStreamParser({ types: ['text'] });
  const pending = await parser.parse(markdownStart + 'not supported', 1);
  expect(pending?.messages[0]?.segments).toEqual([]);
  await expect(parser.parse('{"messages":[{"segments":[{"type":"markdown","data":{"content":"unsupported"}}]}]}', 2, true))
    .rejects.toThrow('message schema');
});

it('rejects unknown fields without changing the ordinary final decoder contract', async () => {
  const parser = createStructuredReplyStreamParser();
  expect(await parser.parse('{"extra":1,"messages":[{"segments":[]', 1)).toBeUndefined();
  expect(await parser.parse('{"messages":[{"extra":1,"segments":[]', 2)).toBeUndefined();
  await expect(parser.parse('{"messages":[{"segments":[{"type":"text","data":{"text":"safe","extra":1}}]}]}', 3, true))
    .rejects.toThrow('message schema');
});

it('withholds partial tool-call markup and rejects complete markup rather than streaming it', async () => {
  const parser = createStructuredReplyStreamParser();
  const pending = await parser.parse(textStart + 'safe <tool_c', 1);
  expect(pending?.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'safe ' } });
  const invalid = await parser.parse(textStart + 'safe <tool_call>', 2);
  expect(invalid?.messages[0]?.segments).toEqual([]);
  await expect(parser.parse(textStart + 'safe <tool_call>"}}]}]}', 3, true)).rejects.toThrow('tool-call markup');
});

it('supports legacy JSON and leaves nonempty reactions on the ordinary ordered path', async () => {
  const parser = createStructuredReplyStreamParser({ types: ['text'], reaction: { values: [{ value: 'ok', label: 'OK' }] } });
  const result = await parser.parse('{"segments":[{"type":"text","data":{"text":"legacy"}}]}', 1, true);
  const withReaction = await parser.parse('{"messages":[{"segments":[{"type":"text","data":{"text":"legacy"}}]}],"reaction":"ok"}', 2, true);
  const expected = [{ key: 'message-0', complete: true,
    segments: [{ key: 'segment-0', complete: true, value: { type: 'text', data: { text: 'legacy' } } }],
  }];
  expect(result?.messages).toEqual(expected);
  expect(withReaction).toBeUndefined();
});

it('waits for a closed empty root reaction before exposing partial words', async () => {
  const parser = createStructuredReplyStreamParser({ types: ['text'], reaction: { values: [{ value: 'ok', label: 'OK' }] } });
  expect(await parser.parse(textStart + 'unknown reaction', 1)).toBeUndefined();
  expect(await parser.parse('{"reaction":"', 2)).toBeUndefined();
  const allowed = await parser.parse('{"reaction":"",' + textStart.slice(1) + 'visible', 3);
  expect(allowed?.messages[0]?.segments[0]?.value).toMatchObject({ data: { text: 'visible' } });
  expect(await parser.parse('{"reaction":"ok",' + textStart.slice(1) + 'ordinary', 4)).toBeUndefined();
  const nested = textStart + '\\"reaction\\":\\"\\"';
  expect(await parser.parse(nested, 5)).toBeUndefined();
});
