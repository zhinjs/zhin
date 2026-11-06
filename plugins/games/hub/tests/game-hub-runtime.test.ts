import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import { childPluginId, createCapabilitySlot, rootPluginId } from 'zhin.js';
import {
  defineGame,
  gameFeatureId,
  GameIndex,
  type GameRecordPort,
  type RuntimeRegisteredGame,
  type GameSessionProvider,
} from '@zhin.js/game-kit';
import plugin from '../plugin.ts';
import gamesCommand from '../commands/games/[[action]]/index.ts';
import statsCommand from '../commands/战绩/index.ts';
import leaderboardCommand from '../commands/排行/[[query]]/index.ts';
import gameCatalogTool from '../skills/game-hub/tools/game_catalog/index.ts';
import pageComponent, { meta as pageMeta } from '../pages/index/index.ts';
import { createGameHubConsoleRpc, gameIndexToken } from '../src/index.js';

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
    locale: 'zh-CN' as const,
    formatCommand: (path: string) => `!!mounted ${path}`,
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
    input: { conversation: { endpoint: { adapter: 'synthetic', id: 'test-account' }, kind: 'private', id: 'alice' }, sender: { id: 'alice', name: 'Alice' }, content: '' } as never,
  };
}

const guess: RuntimeRegisteredGame = {
  id: 'guess', title: '猜数字', icon: '🔢', description: '1~100 七步猜中神秘数',
  commandPrefix: '/猜数', commandPath: 'guess', quickStart: '开始', aliases: ['guess'],
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
      .toContain('!!mounted guess 开始');
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

  it('validates and executes the game_catalog AI tool', async () => {
    expect(parseAgentToolDefinition(gameCatalogTool)).toBe(gameCatalogTool);
    expect(gameCatalogTool.readOnly).toBe(true);

    const games = index([guess]);
    const allResult = await gameCatalogTool.execute(
      {},
      {
        use: (token: unknown) => (token === gameIndexToken ? games : undefined),
        project: (feature: unknown) => (feature === gameFeatureId ? games : undefined),
      } as never,
    );
    expect(allResult.count).toBe(1);
    expect(allResult.games[0]).toMatchObject({
      id: 'guess',
      name: '猜数字',
      aliases: ['guess'],
      minPlayers: 1,
      maxPlayers: 1,
      description: '1~100 七步猜中神秘数',
      startCommand: '/猜数 开始',
    });

    const filtered = await gameCatalogTool.execute(
      { game: 'nonexistent' },
      {
        use: (token: unknown) => (token === gameIndexToken ? games : undefined),
      } as never,
    );
    expect(filtered.count).toBe(0);
    expect(filtered.games).toEqual([]);
  });

  it('exposes Console RPC status via createGameHubConsoleRpc', async () => {
    const games = index([guess]);
    const rpc = createGameHubConsoleRpc();
    const statusMethod = rpc.methods.get('status');
    expect(statusMethod).toBeDefined();
    expect(statusMethod?.page).toBe('index');
    expect(statusMethod?.requiredPermissions).toContain('game-hub:read');

    const snapshot = await statusMethod?.handler(
      {},
      {
        signal: new AbortController().signal,
        runtime: {
          owner: 'root/game-hub' as never,
          generation: 1,
          operator: true,
          project: (feature: unknown) => (feature === gameFeatureId ? games : undefined),
          use: (token: unknown) => (token === gameIndexToken ? games : undefined),
        } as never,
      },
    ) as Record<string, unknown>;

    expect(snapshot).toEqual({
      gameCount: 1,
      games: [
        {
          id: 'guess',
          name: '猜数字',
          aliases: 'guess',
          minPlayers: 1,
          maxPlayers: 1,
          description: '1~100 七步猜中神秘数',
        },
      ],
    });
  });

  it('defines declarative Console page metadata and component', () => {
    expect(pageMeta).toMatchObject({
      title: '游戏大厅',
      titleI18n: { en: 'Game Hub' },
      icon: 'Gamepad2',
      order: 57,
      requiredPermissions: ['game-hub:read'],
    });
    expect(typeof pageComponent).toBe('function');
  });
});

function smokeGameMessage() { return { conversation: { endpoint: { adapter: 'synthetic', id: 'canonical-test' }, kind: 'private' as const, id: 'alice' }, sender: { id: 'alice', name: 'Alice' } }; }
