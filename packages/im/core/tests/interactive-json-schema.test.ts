import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { aiOutboundJsonSchema, outboundSegmentJsonSchema } from '../src/built/segment-contract/json-schema.js';
import { isCanonicalSegment } from '../src/built/segment-contract/assert.js';
import { parseAiOutboundJson } from '../src/built/ai-outbound/parse.js';

const ajv = new Ajv({ allErrors: true });
const validateSegment = ajv.compile(outboundSegmentJsonSchema);
const validatePayload = ajv.compile(aiOutboundJsonSchema);
const button = { id: 'confirm', label: 'Confirm', payload: 'confirm:yes' };
const keyboard = (data: unknown) => ({ type: 'keyboard', data });
const action = (data: unknown) => ({ type: 'action', data });

const valid = [
  keyboard({ rows: [] }),
  keyboard({ rows: [[], [button]] }),
  keyboard({ rows: [[{ ...button, disabled: false }]] }),
  ...['primary', 'danger', 'secondary'].flatMap(style =>
    ['callback', 'command'].map(mode => keyboard({
      rows: [[{ ...button, style, mode, command: { enter: true, reply: false } }]],
      fallback: { hint: 'Enter 1 to confirm', map: { '1': 'confirm:yes' } },
    }))),
  keyboard({ rows: [[{ ...button, command: {}, vendorOption: 'retained' }]], fallback: { hint: '', map: {} } }),
  action({ id: '', payload: '' }),
  action({ id: 'confirm', payload: 'confirm:yes', sourceMessageId: 'message-1', vendorOption: 'retained' }),
];

const invalid = [
  keyboard({}), keyboard({ rows: null }), keyboard({ rows: {} }), keyboard({ rows: [button] }),
  keyboard({ rows: [[null]] }), keyboard({ rows: [[{}]] }),
  ...['id', 'label', 'payload'].map(key => keyboard({ rows: [[{ ...button, [key]: 1 }]] })),
  ...[
    { disabled: 'false' }, { style: 'success' }, { style: null }, { mode: 'native' },
    { mode: 1 }, { command: null }, { command: [] }, { command: { enter: 'true' } }, { command: { reply: 1 } },
  ].map(fields => keyboard({ rows: [[{ ...button, ...fields }]] })),
  ...[null, {}, { hint: 1, map: {} }, { hint: 'hint', map: [] }, { hint: 'hint', map: { '1': 1 } }]
    .map(fallback => keyboard({ rows: [[button]], fallback })),
  action({}), action({ id: 1, payload: 'yes' }), action({ id: 'confirm', payload: null }),
  action({ id: 'confirm', payload: 'yes', sourceMessageId: 1 }),
];

describe('interactive structured outbound schema and parser agreement', () => {
  it.each(valid)('accepts and retains complete valid interaction %#', segment => {
    expect(validateSegment(segment), JSON.stringify(validateSegment.errors)).toBe(true);
    expect(isCanonicalSegment(segment)).toBe(true);
    const payload = { segments: [segment] };
    expect(validatePayload(payload), JSON.stringify(validatePayload.errors)).toBe(true);
    expect(parseAiOutboundJson(JSON.stringify(payload))?.segments).toEqual([segment]);
  });

  it.each(invalid)('rejects malformed interaction before the AI parser can drop it %#', segment => {
    expect(validateSegment(segment)).toBe(false);
    expect(validatePayload({ segments: [segment] })).toBe(false);
    expect(isCanonicalSegment(segment)).toBe(false);
  });

  it('retains a mixed schema-approved message without silently losing interactions', () => {
    const segments = [{ type: 'text', data: { text: 'Choose' } }, ...valid];
    expect(validatePayload({ segments })).toBe(true);
    expect(parseAiOutboundJson(JSON.stringify({ segments }))?.segments).toEqual(segments);
  });

  it('preserves gradual contracts of other Core extensions', () => {
    expect(validateSegment({ type: 'markdown', data: { custom: { vendor: 1 } } })).toBe(true);
    expect(validateSegment({ type: 'html', data: {} })).toBe(true);
  });
});
