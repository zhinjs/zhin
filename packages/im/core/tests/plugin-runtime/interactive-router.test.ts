import { childPluginId, rootPluginId, type PluginId, type PluginNodeSnapshot, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Segment } from '../../src/built/segment-contract/types.js';
import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import type { Message } from '../../src/plugin-runtime/im/contracts.js';

const conversation = { endpoint: { adapter: 'test', id: 'test' }, kind: 'group' as const, id: 'room' };
const message = (content: string, generation = 1) => ({ content, conversation, generation }) as Message;

describe('Interactive fallback numbering', () => {
  it('recognizes expired labels for their exact endpoint/conversation, for a bounded extra TTL', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const router = new RuntimeInteractiveRouter(100);
      router.rememberFallback(conversation, 1, { '1': 'old:action:1' });
      clock.mockReturnValue(1100);
      expect(router.resolvePayload(message('1'))).toBeUndefined();
      expect(router.isExpiredFallback(message('1'))).toBe(true);
      expect(router.isExpiredFallback({ ...message('1'), conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } } } as Message)).toBe(false);
      expect(router.isExpiredFallback({ ...message('1'), conversation: { ...conversation, threadId: 'other' } } as Message)).toBe(false);
      expect(router.isExpiredFallback(message('2'))).toBe(false);
      clock.mockReturnValue(1200);
      expect(router.isExpiredFallback(message('1'))).toBe(false);
      expect(router.rememberFallback(conversation, 2, { '1': 'new:action:1' })).toEqual({ '2': 'new:action:1' });
    } finally { clock.mockRestore(); }
  });
  it('expires keyboards independently without reusing numbers after expiry or generation replacement', () => {
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const router = new RuntimeInteractiveRouter(100);
    try {
      expect(router.rememberFallback(conversation, 1, { '1': 'old' })).toEqual({ '1': 'old' });
      now += 50;
      expect(router.rememberFallback(conversation, 1, { '1': 'new' })).toEqual({ '2': 'new' });
      expect(router.resolvePayload(message('1'))).toBe('old');
      now += 51;
      expect(router.resolvePayload(message('1'))).toBeUndefined();
      expect(router.resolvePayload(message('2'))).toBe('new');
      // The old generation mapping is still live, so this proves isolation.
      expect(router.resolvePayload(message('2', 2))).toBeUndefined();
      now += 100;
      expect(router.rememberFallback(conversation, 2, { '1': 'replacement' })).toEqual({ '3': 'replacement' });
      expect(router.resolvePayload(message('2', 2))).toBeUndefined();
      expect(router.resolvePayload(message('3', 2))).toBe('replacement');
    } finally { clock.mockRestore(); }
  });

  it('shares an increasing counter while isolating lookup by conversation', () => {
    const router = new RuntimeInteractiveRouter();
    expect(router.rememberFallback(conversation, 1, { '1': 'a', cancel: 'stop' })).toEqual({ '1': 'a', cancel: 'stop' });
    expect(router.rememberFallback({ ...conversation, id: 'another' }, 1, { '1': 'b' })).toEqual({ '2': 'b' });
    expect(router.resolvePayload(message('2'))).toBeUndefined();
    expect(router.resolvePayload({ ...message('2'), conversation: { ...conversation, id: 'another' } } as Message)).toBe('b');
    expect(router.resolvePayload(message('cancel'))).toBe('stop');
  });

  it('allocates independent per-conversation counters when numberingScope is conversation', () => {
    const router = new RuntimeInteractiveRouter({ numberingScope: 'conversation' });
    const otherConversation = { ...conversation, id: 'another' };
    expect(router.rememberFallback(conversation, 1, { '1': 'room-a-1', '2': 'room-a-2' })).toEqual({
      '1': 'room-a-1',
      '2': 'room-a-2',
    });
    expect(router.rememberFallback(otherConversation, 1, { '1': 'room-b-1' })).toEqual({
      '1': 'room-b-1',
    });
    expect(router.resolvePayload(message('1'))).toBe('room-a-1');
    expect(router.resolvePayload({ ...message('1'), conversation: otherConversation } as Message)).toBe('room-b-1');
  });

  it('resets per-conversation numbering back to 1 once all fallbacks in that conversation expire', () => {
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const router = new RuntimeInteractiveRouter({ fallbackTtlMs: 100, numberingScope: 'conversation' });
      expect(router.rememberFallback(conversation, 1, { '1': 'first-1', '2': 'first-2' })).toEqual({
        '1': 'first-1',
        '2': 'first-2',
      });
      now += 101;
      expect(router.rememberFallback(conversation, 1, { '1': 'next-1', '2': 'next-2' })).toEqual({
        '1': 'next-1',
        '2': 'next-2',
      });
      expect(router.resolvePayload(message('1'))).toBe('next-1');
    } finally {
      clock.mockRestore();
    }
  });

  it('restarts per-conversation numbering at 1 once every keyboard there has been answered (#1250 b90)', () => {
    const router = new RuntimeInteractiveRouter({ numberingScope: 'conversation' });
    for (let card = 0; card < 7; card += 1) {
      const allocated = router.rememberFallback(conversation, 1, { '1': `card-${card}:yes`, '2': `card-${card}:no`, '3': `card-${card}:always` });
      expect(allocated).toEqual({ '1': `card-${card}:yes`, '2': `card-${card}:no`, '3': `card-${card}:always` });
      expect(router.resolvePayload(message('1'))).toBe(`card-${card}:yes`);
      router.settleFallback([`card-${card}:yes`, `card-${card}:no`, `card-${card}:always`]);
    }
    // Another conversation's settled keyboard does not touch this one's numbering.
    const other = { ...conversation, id: 'another' };
    expect(router.rememberFallback(other, 1, { '1': 'other:a' })).toEqual({ '1': 'other:a' });
    expect(router.rememberFallback(conversation, 1, { '1': 'pending:a' })).toEqual({ '1': 'pending:a' });
    router.settleFallback(['other:a']);
    expect(router.rememberFallback(conversation, 1, { '1': 'next:a' })).toEqual({ '2': 'next:a' });
  });

  it('keeps numbering after a keyboard still waiting for an answer, without reusing its labels (#1250 b90)', () => {
    const router = new RuntimeInteractiveRouter({ numberingScope: 'conversation' });
    expect(router.rememberFallback(conversation, 1, { '1': 'a:yes', '2': 'a:no' })).toEqual({ '1': 'a:yes', '2': 'a:no' });
    expect(router.rememberFallback(conversation, 1, { '1': 'b:yes', '2': 'b:no' })).toEqual({ '3': 'b:yes', '4': 'b:no' });
    // The first card is answered; the second still waits, so a third card keeps counting.
    router.settleFallback(['a:yes', 'a:no']);
    expect(router.rememberFallback(conversation, 1, { '1': 'c:yes', '2': 'c:no' })).toEqual({ '5': 'c:yes', '6': 'c:no' });
    expect(router.resolvePayload(message('3'))).toBe('b:yes');
    expect(router.resolvePayload(message('5'))).toBe('c:yes');
    // Once nothing is pending the next card starts at 1 and its labels win over the settled ones.
    router.settleFallback(['b:yes', 'c:no']);
    expect(router.rememberFallback(conversation, 1, { '1': 'd:yes', '2': 'd:no' })).toEqual({ '1': 'd:yes', '2': 'd:no' });
    expect(router.resolvePayload(message('1'))).toBe('d:yes');
    expect(router.resolvePayload(message('2'))).toBe('d:no');
  });

  it('survives HMR of an unrelated plugin while evicting when the owning plugin reloads', () => {
    const root = rootPluginId();
    const gamePlugin = childPluginId(root, 'game');
    const otherPlugin = childPluginId(root, 'weather');
    const rootNode: PluginNodeSnapshot = { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/', children: [gamePlugin, otherPlugin] };
    const gameNodeV1: PluginNodeSnapshot = { id: gamePlugin, instanceKey: 'game', packageName: 'game', packageRoot: '/game', parent: root, children: [] };
    const otherNodeV1: PluginNodeSnapshot = { id: otherPlugin, instanceKey: 'weather', packageName: 'weather', packageRoot: '/weather', parent: root, children: [] };
    const otherNodeV2: PluginNodeSnapshot = { ...otherNodeV1 };
    const gameNodeV2: PluginNodeSnapshot = { ...gameNodeV1 };

    const makeSnap = (generation: number, gameNode: PluginNodeSnapshot, otherNode: PluginNodeSnapshot): RuntimeSnapshot => ({
      generation,
      root,
      tree: new Map<PluginId, PluginNodeSnapshot>([
        [root, rootNode],
        [gamePlugin, gameNode],
        [otherPlugin, otherNode],
      ]),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map(),
      projections: new Map(),
    });

    const snap1 = makeSnap(1, gameNodeV1, otherNodeV1);
    const snap2UnrelatedHmr = makeSnap(2, gameNodeV1, otherNodeV2);
    const snap3OwnerReload = makeSnap(3, gameNodeV2, otherNodeV2);

    const router = new RuntimeInteractiveRouter({ numberingScope: 'conversation' });
    router.rememberFallback(conversation, 1, { '1': 'game:move:1' }, {
      incarnation: {
        requester: gamePlugin,
        snapshot: snap1,
        node: gameNodeV1,
      },
    });

    // Unrelated plugin (weather) reloaded in generation 2 -> game fallback still resolves!
    expect(router.resolvePayload(message('1', 2), { snapshot: snap2UnrelatedHmr })).toBe('game:move:1');
    expect(router.isExpiredFallback(message('1', 2), snap2UnrelatedHmr)).toBe(false);

    // Owning plugin (game) reloaded in generation 3 -> game fallback is evicted and reported expired!
    expect(router.resolvePayload(message('1', 3), { snapshot: snap3OwnerReload })).toBeUndefined();
    expect(router.isExpiredFallback(message('1', 3), snap3OwnerReload)).toBe(true);
  });

  it('routes prefixed fallback labels after the instance counter reaches multiple digits', () => {
    const router = new RuntimeInteractiveRouter();
    const map = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), `ttt:board:cell-${i}`]));
    expect(router.rememberFallback(conversation, 1, map)['10']).toBe('ttt:board:cell-9');
    expect(router.resolvePayload(message('@bot ttt 10'))).toBe('ttt:board:cell-9');
    expect(router.resolvePayload(message('ttt 11'))).toBeUndefined();
  });
});

describe('Interactive fallback probe', () => {
  const input = (content: string, segments?: Segment[]) => ({ content, ...(segments ? { segments } : {}) });

  it('counts a live keyboard as pending only when the input resolves to a button, per exact endpoint conversation and generation', () => {
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const router = new RuntimeInteractiveRouter(100);
      expect(router.resolvesLiveFallback(conversation, 1, input('1'))).toBe(false);
      router.rememberFallback(conversation, 1, { '1': 'p' });
      expect(router.resolvesLiveFallback(conversation, 1, input('1'))).toBe(true);
      expect(router.resolvesLiveFallback(conversation, 1, input('hello @other'))).toBe(false);
      expect(router.resolvesLiveFallback(conversation, 1, input(''))).toBe(false);
      expect(router.resolvesLiveFallback(conversation, 1, input('', [{ type: 'action', data: { payload: 'p' } }]))).toBe(true);
      expect(router.resolvesLiveFallback(conversation, 2, input('1'))).toBe(false);
      expect(router.resolvesLiveFallback({ ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } }, 1, input('1'))).toBe(false);
      expect(router.resolvePayload(message('1'))).toBe('p');
      now += 101;
      expect(router.resolvesLiveFallback(conversation, 1, input('1'))).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it('counts an action segment only when its payload belongs to a live fallback map of this conversation', () => {
    const router = new RuntimeInteractiveRouter(100);
    const action = (payload: string) => input('', [{ type: 'action', data: { payload } }]);
    expect(router.resolvesLiveFallback(conversation, 1, action('p'))).toBe(false);
    router.rememberFallback(conversation, 1, { '1': 'p', yes: 'q' });
    expect(router.resolvesLiveFallback(conversation, 1, action('p'))).toBe(true);
    expect(router.resolvesLiveFallback(conversation, 1, action('q'))).toBe(true);
    expect(router.resolvesLiveFallback(conversation, 1, action('foreign'))).toBe(false);
    expect(router.resolvesLiveFallback(conversation, 1, input('1', [{ type: 'action', data: { payload: 'foreign' } }]))).toBe(false);
    expect(router.resolvesLiveFallback(conversation, 2, action('p'))).toBe(false);
    expect(router.resolvesLiveFallback({ ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } }, 1, action('p'))).toBe(false);
  });

  it('does not prune or otherwise mutate state', () => {
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const router = new RuntimeInteractiveRouter(100);
      router.rememberFallback(conversation, 1, { '1': 'p' });
      now += 101;
      expect(router.resolvesLiveFallback(conversation, 1, input('1'))).toBe(false);
      // The probe left the expired entry for the normal path to retire, so it still reads as an expired button.
      expect(router.isExpiredFallback(message('1'))).toBe(true);
    } finally { clock.mockRestore(); }
  });
});
