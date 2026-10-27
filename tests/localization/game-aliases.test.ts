import bj from '../../plugins/games/blackjack/middlewares/bj-alias/index.js';
import dice from '../../plugins/games/dice-duel/middlewares/dice-alias/index.js';
import rps from '../../plugins/games/rps/middlewares/rps-alias/index.js';
import guess from '../../plugins/games/guess-number/middlewares/guess-alias/index.js';
import chain from '../../plugins/games/idiom-chain/middlewares/chain-alias/index.js';
import riddle from '../../plugins/games/word-riddle/middlewares/riddle-alias/index.js';
import adv from '../../plugins/games/text-adventure/middlewares/adv-alias/index.js';
import ttt from '../../plugins/games/tic-tac-toe/middlewares/ttt-alias/index.js';

describe.each([
  ['bj', bj], ['dice', dice], ['rps', rps], ['guess', guess],
  ['chain', chain], ['riddle', riddle], ['adv', adv], ['ttt', ttt],
] as const)('%s shortcut help', (name, middleware) => {
  it('uses each incoming locale and the current owner-aware command formatter', async () => {
    for (const locale of ['en', 'zh-CN', 'en'] as const) {
      const owner = `root/${name}-instance`;
      const formatCommand = vi.fn((path: string, commandOwner: string) =>
        commandOwner === owner && path === name ? `!games:${name}` : undefined);
      const $reply = vi.fn();
      const next = vi.fn();
      await middleware.handle({
        owner: { id: owner },
        input: {
          content: `${name} help`, locale, formatCommand, $reply,
          conversation: { endpoint: { id: 'endpoint', adapter: 'test' }, kind: 'private', id: 'user' },
          sender: { id: 'user' },
        },
      } as never, next);
      const text = $reply.mock.calls[0]?.[0];
      expect(text).toContain(`!games:${name}`);
      expect(formatCommand).toHaveBeenCalledWith(name, owner);
      expect(/[\u3400-\u9fff]/u.test(text)).toBe(locale === 'zh-CN');
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('omits unknown command paths instead of inventing a prefix', async () => {
    const $reply = vi.fn();
    await middleware.handle({
      owner: { id: `root/${name}` },
      input: { content: `${name} help`, locale: 'en', $reply,
        sender: { id: 'user' }, formatCommand: () => undefined },
    } as never, vi.fn());
    expect($reply).toHaveBeenCalledOnce();
    expect($reply.mock.calls[0]?.[0]).not.toContain(`/${name}`);
  });
});
