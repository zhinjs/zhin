import bj from '../../plugins/games/blackjack/commands/bj/[[action]]/index.js';
import dice from '../../plugins/games/dice-duel/commands/dice/[[action]]/index.js';
import rps from '../../plugins/games/rps/commands/rps/[[action]]/index.js';
import guess from '../../plugins/games/guess-number/commands/guess/[[action]]/index.js';
import chain from '../../plugins/games/idiom-chain/commands/chain/[[action]]/index.js';
import riddle from '../../plugins/games/word-riddle/commands/riddle/[[action]]/index.js';
import adv from '../../plugins/games/text-adventure/commands/adv/[[action]]/index.js';
import ttt from '../../plugins/games/tic-tac-toe/commands/ttt/[[action]]/index.js';

// #1250 第 82 批: the short entries are the commands themselves (`match` / `alias`), so the help a
// short word answers is the command's own, formatted with the command's owner-aware formatter.
describe.each([
  ['bj', bj, '21点'], ['dice', dice, '骰子'], ['rps', rps, '猜拳'], ['guess', guess, '猜数'],
  ['chain', chain, '接龙'], ['riddle', riddle, '猜谜'], ['adv', adv, '冒险'], ['ttt', ttt, undefined],
] as const)('%s short-entry help', (name, command, shortWord) => {
  const help = async (locale: 'en' | 'zh-CN', formatCommand: (path: string) => string | undefined, text?: string) => {
    const match = text && command.match ? command.match.exec(text) ?? undefined : undefined;
    return command.execute({ params: { action: text ? '' : 'help' }, match, locale, formatCommand } as never) as Promise<string>;
  };

  it('uses each incoming locale and the command formatter', async () => {
    for (const locale of ['en', 'zh-CN', 'en'] as const) {
      const formatCommand = vi.fn((path: string) => path === name ? `!games:${name}` : undefined);
      const text = await help(locale, formatCommand);
      expect(text).toContain(`!games:${name}`);
      expect(formatCommand).toHaveBeenCalledWith(name);
      expect(/[\u3400-\u9fff]/u.test(text)).toBe(locale === 'zh-CN');
      if (shortWord) expect(await help(locale, formatCommand, `${shortWord} 帮助`)).toBe(text);
    }
  });

  it('omits unknown command paths instead of inventing a prefix', async () => {
    expect(await help('en', () => undefined)).not.toContain(`/${name}`);
  });
});
