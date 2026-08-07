import { describe, expect, it, beforeEach, vi } from 'vitest';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import inbound from '../middlewares/inbound.ts';
import outbound from '../middlewares/outbound.ts';
import {
  DEFAULT_ACTIONS,
  BUILTIN_LEXICON,
  findMatches,
  getModerationEngine,
  HttpModerationProvider,
  isPublicHttpUrl,
  LocalLexiconProvider,
  mergeResults,
  ModerationEngine,
  parseHttpResult,
  parseWordFile,
  redactOutboundPayload,
  redactText,
  resetModerationEngine,
  resolveModerationConfig,
  shouldBypassInbound,
  shouldBypassOutbound,
} from '../src/index.js';
import type { ProviderResult, ScanInput } from '../src/types.js';

describe('@zhin.js/plugin-content-moderation', () => {
  beforeEach(() => {
    resetModerationEngine();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('content-moderation');
  });

  it('brands inbound and outbound middleware', () => {
    expect(parseMiddlewareDefinition(inbound)).toBe(inbound);
    expect(parseMiddlewareDefinition(outbound)).toBe(outbound);
    expect(inbound.target).toBe('inbound');
    expect(outbound.target).toBe('outbound');
    expect(inbound.order).toBe(-100);
  });

  it('resolves strict default actions', () => {
    const config = resolveModerationConfig({});
    expect(config.actions).toEqual(DEFAULT_ACTIONS);
    expect(config.actions.critical).toEqual(['drop', 'recall']);
    expect(config.outbound.bypass).toBe(false);
  });

  it('bypasses inbound for masters and whitelist', () => {
    const config = resolveModerationConfig({
      masters: ['m1'],
      inbound: {
        bypassMasters: true,
        whitelist: { userIds: ['u2'], conversationIds: ['g9'] },
      },
    });
    expect(shouldBypassInbound(config, {
      sender: 'm1',
      conversationId: 'g1',
    })).toBe(true);
    expect(shouldBypassInbound(config, {
      sender: 'u2',
      conversationId: 'g1',
    })).toBe(true);
    expect(shouldBypassInbound(config, {
      sender: 'other',
      conversationId: 'g9',
    })).toBe(true);
    expect(shouldBypassInbound(config, {
      sender: 'other',
      conversationId: 'g1',
    })).toBe(false);
  });

  it('bypasses outbound only when configured', () => {
    expect(shouldBypassOutbound(resolveModerationConfig({}))).toBe(false);
    expect(shouldBypassOutbound(resolveModerationConfig({
      outbound: { bypass: true },
    }))).toBe(true);
    expect(shouldBypassOutbound(resolveModerationConfig({
      enabled: false,
    }))).toBe(true);
  });

  it('finds lexicon matches and prefers longer words', () => {
    const matches = findMatches('xx敏感词yy', ['敏感', '敏感词']);
    expect(matches.some((m) => m.start === 2 && m.end === 5)).toBe(true);
  });

  it('local lexicon returns per-word severity and max of hits', async () => {
    const provider = new LocalLexiconProvider({
      id: 'local',
      type: 'local',
      enabled: true,
      onError: 'open',
      words: [
        { word: 'bad', severity: 'medium' },
        { word: 'nuke', severity: 'critical' },
      ],
      wordFiles: [],
      includeBuiltin: false,
      defaultSeverity: 'high',
    });
    expect((await provider.scan(scan({ text: 'this is bad' }))).severity).toBe('medium');
    expect((await provider.scan(scan({ text: 'bad and nuke' }))).severity).toBe('critical');
    expect((await provider.scan(scan({ text: 'clean' }))).severity).toBe('pass');
  });

  it('merges builtin lexicon when includeBuiltin is true', async () => {
    const provider = new LocalLexiconProvider({
      id: 'local',
      type: 'local',
      enabled: true,
      onError: 'open',
      words: [],
      wordFiles: [],
      includeBuiltin: true,
      defaultSeverity: 'high',
    });
    // 内置 high 词：约炮
    const hit = await provider.scan(scan({ text: '测试约炮内容' }));
    expect(hit.severity).toBe('high');
    expect(BUILTIN_LEXICON.some((e) => e.word === '约炮')).toBe(true);
    expect(BUILTIN_LEXICON.some((e) => e.word === '违禁词')).toBe(false);
    expect(BUILTIN_LEXICON.length).toBeGreaterThan(10);
  });

  it('parses graded word-file lines', () => {
    const entries = parseWordFile([
      '# comment',
      'plain',
      'low:轻描',
      '重口|critical',
    ].join('\n'), 'medium');
    expect(entries).toEqual([
      { word: 'plain', severity: 'medium' },
      { word: '轻描', severity: 'low' },
      { word: '重口', severity: 'critical' },
    ]);
  });

  it('resolves config words as string or {word,severity}', () => {
    const config = resolveModerationConfig({
      sources: [{
        id: 'local',
        type: 'local',
        words: ['a', { word: 'b', severity: 'low' }],
        severity: 'medium',
      }],
    });
    const local = config.sources[0];
    expect(local?.type).toBe('local');
    if (local?.type !== 'local') throw new Error('expected local');
    expect(local.includeBuiltin).toBe(true);
    expect(local.defaultSeverity).toBe('medium');
    expect(local.words).toEqual([
      { word: 'a', severity: 'medium' },
      { word: 'b', severity: 'low' },
    ]);
  });

  it('merges provider results by max severity and union images', () => {
    const merged = mergeResults([
      { sourceId: 'a', severity: 'low', matches: [{ start: 0, end: 1 }] },
      { sourceId: 'b', severity: 'high', flaggedImageIndexes: [1] },
      { sourceId: 'c', severity: 'medium', flaggedImageIndexes: [0, 1] },
    ] satisfies ProviderResult[]);
    expect(merged.severity).toBe('high');
    expect(merged.flaggedImageIndexes).toEqual([0, 1]);
    expect(merged.matches).toEqual([{ start: 0, end: 1 }]);
  });

  it('redacts text spans and whole text without spans', () => {
    expect(redactText('hello', [{ start: 1, end: 4 }], '*')).toBe('h***o');
    expect(redactText('ab', [], '*')).toBe('***');
  });

  it('redacts outbound segments and drops flagged images', () => {
    const payload = [
      { type: 'text', data: { text: 'say bad now' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/a.png' } } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/b.png' } } },
    ];
    const extracted = {
      text: 'say bad now',
      images: [
        { index: 0, segmentIndex: 1, url: 'https://x/a.png' },
        { index: 1, segmentIndex: 2, url: 'https://x/b.png' },
      ],
    };
    const redacted = redactOutboundPayload(payload, extracted, {
      maskChar: '*',
      matches: [{ start: 4, end: 7 }],
      flaggedImageIndexes: [1],
    }) as Array<{ type: string; data: { text?: string } }>;
    expect(redacted).toHaveLength(2);
    expect(redacted[0]?.data.text).toBe('say *** now');
    expect(redacted[1]?.type).toBe('image');
  });

  it('http provider posts json urls and parses response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      severity: 'medium',
      matches: [{ start: 0, end: 2 }],
      images: [{ index: 0, flagged: true }],
      reason: 'ok',
    }), { status: 200 }));

    const provider = new HttpModerationProvider({
      id: 'http-1',
      type: 'http',
      enabled: true,
      onError: 'closed',
      url: 'https://example.com/moderate',
      headers: { Authorization: 'Bearer t' },
      timeoutMs: 2000,
      forceUpload: false,
    }, { fetch: fetchMock as unknown as typeof fetch });

    const result = await provider.scan(scan({
      text: 'hi',
      images: [{ index: 0, url: 'https://cdn.example/a.png' }],
    }));
    expect(result.severity).toBe('medium');
    expect(result.flaggedImageIndexes).toEqual([0]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.headers && (init.headers as Record<string, string>)['content-type']))
      .toContain('application/json');
  });

  it('http provider uses onError closed on failure', async () => {
    const provider = new HttpModerationProvider({
      id: 'http-1',
      type: 'http',
      enabled: true,
      onError: 'closed',
      url: 'https://example.com/moderate',
      headers: {},
      timeoutMs: 500,
      forceUpload: false,
    }, {
      fetch: vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    const result = await provider.scan(scan({ text: 'x' }));
    expect(result.severity).toBe('critical');
    expect(result.error).toBe(true);
  });

  it('http provider uses onError open on failure', async () => {
    const provider = new HttpModerationProvider({
      id: 'http-1',
      type: 'http',
      enabled: true,
      onError: 'open',
      url: 'https://example.com/moderate',
      headers: {},
      timeoutMs: 500,
      forceUpload: false,
    }, {
      fetch: vi.fn(async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    });
    const result = await provider.scan(scan({ text: 'x' }));
    expect(result.severity).toBe('pass');
    expect(result.error).toBe(true);
  });

  it('parseHttpResult and url helper', () => {
    expect(isPublicHttpUrl('https://a.com/x')).toBe(true);
    expect(isPublicHttpUrl('file:///tmp/x')).toBe(false);
    expect(parseHttpResult('s', { severity: 'low' }).severity).toBe('low');
    expect(() => parseHttpResult('s', { severity: 'nope' })).toThrow();
  });

  it('engine continues inbound on redact and continues outbound after replace', async () => {
    const engine = new ModerationEngine({ logger: silentLogger() });
    engine.configure({
      sources: [{
        id: 'local',
        type: 'local',
        words: ['bad'],
        severity: 'medium',
        includeBuiltin: false,
      }],
    });

    const inbound = await engine.apply({
      direction: 'inbound',
      extracted: { text: 'bad word', images: [] },
      scanInput: scan({ text: 'bad word' }),
      hooks: {},
    });
    expect(inbound.continue).toBe(true);
    expect(inbound.severity).toBe('medium');

    let replaced: unknown;
    const outbound = await engine.apply({
      direction: 'outbound',
      extracted: { text: 'bad word', images: [] },
      scanInput: scan({ text: 'bad word', direction: 'outbound' }),
      hooks: {
        getPayload: () => 'bad word',
        replacePayload: (p) => { replaced = p; },
      },
    });
    expect(outbound.continue).toBe(true);
    expect(typeof replaced).toBe('string');
    expect(String(replaced)).toContain('*');
  });

  it('engine drops on high and recalls when hook succeeds', async () => {
    const engine = new ModerationEngine({ logger: silentLogger() });
    engine.configure({
      sources: [{
        id: 'local',
        type: 'local',
        words: ['nuke'],
        severity: 'critical',
        includeBuiltin: false,
      }],
    });
    const recall = vi.fn(async () => true);
    const result = await engine.apply({
      direction: 'inbound',
      extracted: { text: 'nuke', images: [] },
      scanInput: scan({ text: 'nuke' }),
      hooks: { recall },
    });
    expect(result.continue).toBe(false);
    expect(result.actions).toContain('drop');
    expect(result.actions).toContain('recall');
    expect(recall).toHaveBeenCalledOnce();
  });

  it('shared engine singleton resets', () => {
    const first = getModerationEngine();
    resetModerationEngine();
    expect(getModerationEngine()).not.toBe(first);
  });
});

function scan(partial: {
  text: string;
  images?: ScanInput['images'];
  direction?: ScanInput['direction'];
}): ScanInput {
  return {
    text: partial.text,
    images: partial.images ?? [],
    direction: partial.direction ?? 'inbound',
    context: {
      adapter: 'sandbox',
      endpoint: 'bot',
      conversationKind: 'group',
      conversationId: 'g1',
      sender: 'u1',
    },
  };
}

function silentLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => silentLogger(),
  } as ReturnType<typeof import('@zhin.js/logger').getLogger>;
}
