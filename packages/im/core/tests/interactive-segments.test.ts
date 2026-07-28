import { describe, it, expect, beforeEach } from 'vitest';
import { segment } from '../src/utils.js';
import {
  resolveInteractiveSegments,
  registerInteractiveHandler,
  resetInteractiveHandlersForTests,
  ensureInteractiveMiddleware,
  collectKeyboardFallbackMaps,
  getActionFromMessage,
  isActionMessage,
  actionSegment,
  stripInteractiveCommandText,
  resolvePayloadFromText,
  keyboardFallbackStore,
  resetKeyboardFallbackStoreForTests,
} from '../src/built/interactive-segments/index.js';
import { Message } from '../src/message.js';

describe('resolveInteractiveSegments', () => {
  const board = [
    segment.text('轮到 X'),
    segment.keyboard([
      [
        segment.button({ id: 'c0', label: '·', payload: 'ttt:s1:0' }),
        segment.button({ id: 'c1', label: '✕', payload: 'ttt:s1:1', disabled: true }),
      ],
    ], { fallback: { hint: '落子 1-9', map: { '1': 'ttt:s1:0', '2': 'ttt:s1:1' } } }),
  ];

  it('keeps keyboard segment when policy is native', () => {
    const out = resolveInteractiveSegments(board, 'native');
    const arr = Array.isArray(out) ? out : [out];
    expect(arr.some((s) => typeof s !== 'string' && s.type === 'keyboard')).toBe(true);
  });

  it('degrades keyboard to text when policy is text', () => {
    const out = resolveInteractiveSegments(board, 'text');
    const raw = segment.raw(out);
    expect(raw).toContain('轮到 X');
    expect(raw).toContain('落子 1-9');
    expect(raw).toContain('1.');
  });
});

describe('registerInteractiveHandler', () => {
  beforeEach(() => resetInteractiveHandlersForTests());

  it('matches longest prefix', async () => {
    const calls: string[] = [];
    registerInteractiveHandler('ttt:', async (msg) => {
      calls.push(Message.actionPayload(msg) ?? '');
      return true;
    });
    registerInteractiveHandler('ttt:bot:', async () => {
      calls.push('bot');
      return true;
    });

    const msg = Message.from(
      {},
      {
        $id: '1',
        $adapter: 'sandbox',
        $endpoint: 'b',
        $sender: { id: 'u1' },
        $channel: { id: 'c', type: 'group' },
        $content: [actionSegment({ id: 'a', payload: 'ttt:s1:4' })],
        $timestamp: Date.now(),
      },
    );
    expect(getActionFromMessage(msg)?.payload).toBe('ttt:s1:4');
    expect(isActionMessage(msg)).toBe(true);
  });

  it('isActionMessage is false for text messages', () => {
    const msg = Message.from(
      {},
      {
        $id: '2',
        $adapter: 'sandbox',
        $endpoint: 'b',
        $sender: { id: 'u1' },
        $channel: { id: 'c', type: 'group' },
        $content: [{ type: 'text', data: { text: 'hello' } }],
        $timestamp: Date.now(),
      },
    );
    expect(isActionMessage(msg)).toBe(false);
  });
});

describe('stripInteractiveCommandText / resolvePayloadFromText', () => {
  it('strips @bot prefix and at segments', () => {
    expect(stripInteractiveCommandText('@mybot hub:g1:g_ttt')).toBe('hub:g1:g_ttt');
    expect(stripInteractiveCommandText('<at id=\'123\'/> hub:g1:g_ttt')).toBe('hub:g1:g_ttt');
  });

  it('resolves direct payload from normalized text', () => {
    expect(resolvePayloadFromText('@bot ttt:s1:4')).toBe('ttt:s1:4');
  });

  it('resolves numeric fallback via map', () => {
    const map = { '1': 'hub:scope:g_ttt', '2': 'hub:scope:g_rps' };
    expect(resolvePayloadFromText('2', map)).toBe('hub:scope:g_rps');
    expect(resolvePayloadFromText('@bot 1', map)).toBe('hub:scope:g_ttt');
  });
});


describe('KeyboardFallbackStore（中央 fallback 存储）', () => {
  beforeEach(() => resetKeyboardFallbackStoreForTests());

  it('remember / mapFor / resolve 数字回跳', () => {
    keyboardFallbackStore.remember('ch-1', { '1': 'hub:h1:g_ttt', '2': 'hub:h1:g_rps' });
    expect(keyboardFallbackStore.mapFor('ch-1')).toEqual({ '1': 'hub:h1:g_ttt', '2': 'hub:h1:g_rps' });
    expect(keyboardFallbackStore.resolve('ch-1', '2')).toBe('hub:h1:g_rps');
    expect(keyboardFallbackStore.resolve('ch-1', '9')).toBeUndefined();
    expect(keyboardFallbackStore.resolve('missing', '1')).toBeUndefined();
  });

  it('后写覆盖先写（最近一张键盘生效）', () => {
    keyboardFallbackStore.remember('ch-1', { '1': 'hub:h1:g_ttt' });
    keyboardFallbackStore.remember('ch-1', { '1': 'ttt:s1:4' });
    expect(keyboardFallbackStore.resolve('ch-1', '1')).toBe('ttt:s1:4');
  });

  it('TTL 过期即失效；空 map 忽略', () => {
    keyboardFallbackStore.remember('ch-1', { '1': 'hub:h1:g_ttt' }, -1);
    expect(keyboardFallbackStore.mapFor('ch-1')).toBeUndefined();
    keyboardFallbackStore.remember('ch-2', {});
    expect(keyboardFallbackStore.mapFor('ch-2')).toBeUndefined();
  });
});

describe('collectKeyboardFallbackMaps', () => {
  it('显式 fallback.map 优先，无显式时按按钮顺序自动编号', () => {
    const content = [
      segment.text('menu'),
      segment.keyboard([
        [segment.button({ id: 'a', label: '甲', payload: 'x:s:a' })],
      ], { fallback: { hint: 'h', map: { '3': 'x:s:a' } } }),
      segment.keyboard([
        [
          segment.button({ id: 'b', label: '乙', payload: 'y:s:b' }),
          segment.button({ id: 'c', label: '丙', payload: 'y:s:c' }),
        ],
      ]),
    ];
    expect(collectKeyboardFallbackMaps(content)).toEqual([
      { '3': 'x:s:a' },
      { '1': 'y:s:b', '2': 'y:s:c' },
    ]);
    expect(collectKeyboardFallbackMaps('plain')).toEqual([]);
    expect(collectKeyboardFallbackMaps(undefined)).toEqual([]);
  });
});

describe('interactive 文本回跳中间件（旧轨）', () => {
  beforeEach(() => {
    resetInteractiveHandlersForTests();
    resetKeyboardFallbackStoreForTests();
  });

  function textMessage(raw: string) {
    return Message.from({}, {
      $id: '1',
      $adapter: 'sandbox',
      $endpoint: 'b',
      $sender: { id: 'u1' },
      $channel: { id: 'c', type: 'group' },
      $content: [{ type: 'text', data: { text: raw } }],
      $raw: raw,
      $timestamp: Date.now(),
    });
  }

  function installMiddleware() {
    let installed: ((msg: never, next: () => Promise<void>) => Promise<void>) | undefined;
    ensureInteractiveMiddleware((mw) => { installed = mw as never; });
    return {
      run: (msg: ReturnType<typeof textMessage>) =>
        new Promise<boolean>((resolve) => {
          void installed!(msg as never, async () => { resolve(false); })
            .then(() => resolve(true));
        }),
    };
  }

  it('裸数字经中央 fallback map 路由到注册 handler', async () => {
    const calls: string[] = [];
    registerInteractiveHandler('hub:', async () => { calls.push('hub'); return true; });
    keyboardFallbackStore.remember('sandbox-b-group:c', { '1': 'hub:h1:g_ttt' });
    const { run } = installMiddleware();

    expect(await run(textMessage('1'))).toBe(true);
    expect(calls).toEqual(['hub']);
  });

  it('指令预填直出 payload 同样路由（prefix 最长匹配）', async () => {
    const calls: string[] = [];
    registerInteractiveHandler('hub:', async () => { calls.push('hub'); return true; });
    registerInteractiveHandler('hub:bot:', async () => { calls.push('hub:bot'); return true; });
    const { run } = installMiddleware();

    expect(await run(textMessage('@mybot hub:bot:s1'))).toBe(true);
    expect(calls).toEqual(['hub:bot']);
  });

  it('无映射 / 无匹配 handler 时放行 next', async () => {
    registerInteractiveHandler('hub:', async () => true);
    const { run } = installMiddleware();

    expect(await run(textMessage('1'))).toBe(false);
    expect(await run(textMessage('普通文本'))).toBe(false);
    // 有映射但 handler 返回 false 也放行
    keyboardFallbackStore.remember('sandbox-b-group:c', { '1': 'other:s:1' });
    expect(await run(textMessage('1'))).toBe(false);
  });
});
