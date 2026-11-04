const work = vi.hoisted(() => ({ enabled: false, calls: 0, characters: 0 }));
vi.mock('@zhin.js/ai', async original => {
  const actual = await original<typeof import('@zhin.js/ai')>();
  return { ...actual, parsePartialJson: (raw: string | undefined) => {
    if (work.enabled) { work.calls++; work.characters += raw?.length ?? 0; }
    return actual.parsePartialJson(raw);
  } };
});

import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';
import { createLegacyStructuredReplyStreamParser } from './structured-reply-stream-baseline.js';

afterEach(() => { work.enabled = false; });

it.each(['non-json', 'withheld-reaction', 'visible-text'] as const)(
  'avoids cumulative SDK parses for %s while matching the original snapshots', async scenario => {
    const profile = { types: ['text'] as const, reaction: { values: [{ value: 'ok', label: 'OK' }] } };
    const header = scenario === 'non-json' ? 'ordinary prose '
      : `{"reaction":"${scenario === 'withheld-reaction' ? 'ok' : ''}","messages":[{"segments":[{"type":"text","data":{"text":"`;
    const old = createLegacyStructuredReplyStreamParser(profile), candidate = createStructuredReplyStreamParser(profile);
    let raw = header;
    candidate.append(header);
    work.enabled = true;
    for (let revision = 1; revision <= 300; revision++) {
      const delta = 'x'.repeat(64);
      raw += delta; candidate.append(delta);
      work.calls = 0; work.characters = 0;
      const expected = await old.parse(raw, revision);
      expect(work.calls).toBe(1);
      expect(work.characters).toBe(raw.length);
      work.calls = 0; work.characters = 0;
      expect(await candidate.snapshot(revision)).toEqual(expected);
      expect(work.calls).toBe(0);
    }
  },
);

it.each(['-12', '-0', '0.5', '1e+3', '1e-3', '9007199254740992', '1e309'])(
  'resumes incremental text after a completed numeric segment field: %s', async number => {
    const header = `{"messages":[{"segments":[{"type":"face","data":{"id":${number}}},`
      + '{"type":"text","data":{"text":"';
    const profile = { types: ['face', 'text'] as const };
    const candidate = createStructuredReplyStreamParser(profile), old = createLegacyStructuredReplyStreamParser(profile);
    candidate.append(header);
    let raw = header;
    work.enabled = true;
    for (let revision = 1; revision <= 300; revision++) {
      const delta = 'x'.repeat(64);
      raw += delta; candidate.append(delta);
      const expected = await old.parse(raw, revision);
      if (Number.isFinite(Number(number))) expect(expected?.messages[0]?.segments[1]?.value.type).toBe('text');
      work.calls = 0;
      expect(await candidate.snapshot(revision)).toEqual(expected);
      expect(work.calls).toBe(0);
    }
  },
);
