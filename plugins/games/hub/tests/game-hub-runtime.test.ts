import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { childPluginId, createCapabilitySlot, rootPluginId } from 'zhin.js';
import {
  defineGame,
  gameFeatureId,
  GameIndex,
  smokeGameMessage,
  type GameRecordPort,
  type RuntimeRegisteredGame,
  type GameSessionProvider,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import gamesCommand from '../commands/games/[[action]]/index.ts';
import statsCommand from '../commands/战绩/index.ts';
import leaderboardCommand from '../commands/排行/[[query]]/index.ts';

function index(games: RuntimeRegisteredGame[] = [], records?: Partial<GameRecordPort>): GameIndex {
  const port: GameRecordPort = {
    record: async () => undefined,
    getUserStats: async () => [],
    getLeaderboard: async () => [],
    ...records,
  };
  const session = (gameId: string): GameSessionProvider => ({
    gameId,
    getActiveForUser: async () => null,
    bindAvailability: () => undefined,
  });
  return new GameIndex(games.map((game) => createCapabilitySlot({
    owner: childPluginId(rootPluginId(), game.id),
    feature: gameFeatureId,
    localName: game.id,
    source: 'test',
    origin: 'setup',
    definition: defineGame(game, port, session(game.id)),
  })));
}

function commandContext(games: GameIndex) {
  return {
    owner: {} as never,
    generation: 1,
    config: {},
    signal: new AbortController().signal,
    use: () => { throw new Error('unused'); },
    project: (feature: unknown) => {
      if (feature === gameFeatureId) return games;
      throw new Error('unexpected feature');
    },
    args: [] as string[],
    params: {} as Record<string, string | number | boolean>,
    input: undefined as never,
  };
}

const guess: RuntimeRegisteredGame = {
  id: 'guess', title: '猜数字', icon: '🔢', description: '1~100 七步猜中神秘数',
  commandPrefix: '/猜数', quickStart: '开始', aliases: ['guess'],
};

describe('@zhin.js/plugin-game-hub runtime', () => {
  it('defines a valid Plugin Runtime entry and commands', () => {
    expect(plugin.name).toBe('game-hub');
    expect(parseCommandDefinition(gamesCommand)).toBe(gamesCommand);
    expect(parseCommandDefinition(statsCommand)).toBe(statsCommand);
    expect(parseCommandDefinition(leaderboardCommand)).toBe(leaderboardCommand);
  });

  it('reads the generation GameIndex for help and action hints', async () => {
    const empty = await gamesCommand.execute({ ...commandContext(index()), params: {} });
    expect(String(empty)).toContain('暂无已加载的游戏插件');
    const context = commandContext(index([guess]));
    expect(String(await gamesCommand.execute({ ...context, params: {} }))).toContain('猜数字');
    expect(String(await gamesCommand.execute({ ...context, params: { action: 'guess' } })))
      .toContain('/猜数 开始');
  });

  it('aggregates stats through the selected game record port', async () => {
    const games = index([guess], {
      getUserStats: async () => [{
        gameId: 'guess', wins: 2, losses: 1, draws: 0, totalScore: 8, games: 3,
      }],
    });
    const text = await statsCommand.execute({
      ...commandContext(games), input: smokeGameMessage() as never,
    });
    expect(String(text)).toContain('猜数字');
    expect(String(text)).toContain('2 胜 1 负');
  });

  it('queries the selected game leaderboard and diagnoses unknown games', async () => {
    const games = index([guess], {
      getLeaderboard: async () => [{ userId: 'u1', userName: 'User', wins: 1, totalScore: 2, games: 1 }],
    });
    const text = await leaderboardCommand.execute({
      ...commandContext(games), params: { query: '猜数字' }, input: smokeGameMessage() as never,
    });
    expect(String(text)).toContain('User');
    const missing = await leaderboardCommand.execute({
      ...commandContext(games), params: { query: '扫雷' }, input: smokeGameMessage() as never,
    });
    expect(String(missing)).toContain('未找到游戏「扫雷」');
  });
});
