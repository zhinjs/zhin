/** #1250 game-command-names-mixed-language / game-quit-means-forfeit. */
import { describe, expect, it } from 'vitest';
import { formatGameHelp, gameCommandHint } from '../src/game-command-help.js';
import { normalizeGuessAction, normalizeRpsAction, normalizeTttAction } from '../src/game-action-alias.js';

const help = (command: string, locale: 'zh-CN' | 'en') => formatGameHelp({
  presentation: { locale, formatCommand: () => command },
  title: { 'zh-CN': '井字棋', en: 'Tic-Tac-Toe' }, commandPath: 'ttt', actions: ['bot', 'join', 'forfeit', 'spectate'],
});

describe('game command help language', () => {
  it('writes subcommands in the language of the command name', () => {
    expect(help('/井字棋', 'zh-CN')).toContain('/井字棋 认输 — 认输并结束对局');
    expect(help('/井字棋', 'zh-CN')).toContain('/井字棋 加入 — 加入排队');
    expect(help('/井字棋', 'zh-CN')).not.toMatch(/ (?:bot|join|quit|spectate) /u);
    expect(help('/ttt', 'en')).toContain('/ttt quit — Concede and end the game');
    expect(help('/ttt', 'en')).toContain('/ttt spectate — Spectate');
    expect(gameCommandHint({ locale: 'zh-CN', formatCommand: () => '/猜数字' }, 'guess')).toBe('发送「/猜数字 开始」开始。');
    expect(gameCommandHint({ locale: 'en', formatCommand: () => '/guess' }, 'guess')).toBe('Send “/guess start” to start.');
  });

  it('accepts every shown Chinese name and keeps the English ones', () => {
    for (const [zh, en] of [['人机', 'bot'], ['加入', 'join'], ['离开', 'leave'], ['认输', 'quit'], ['退出', 'quit'], ['观战', 'spectate']]) {
      expect(normalizeTttAction(zh!)).toBe(en);
      expect(normalizeTttAction(en!)).toBe(en);
    }
    for (const word of ['开始', '退出', 'start', 'quit']) expect(['start', 'quit']).toContain(normalizeGuessAction(word));
    expect(normalizeRpsAction('继续')).toBe('continue');
    expect(normalizeRpsAction('退出')).toBe('quit');
  });
});
