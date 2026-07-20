import { describe, expect, it, vi } from 'vitest';
import {
  CommandFeature,
  MANAGEMENT_OPERATOR_PERMIT,
  MessageCommand,
  PermissionFeature,
  Plugin,
  registerEndpointManagementCommands,
} from 'zhin.js';
import {
  collectSupplementaryCommandHelp,
  filterHelpCommands,
  formatSupplementaryCommandsHelp,
  type CommandHelpSource,
} from '../src/command-help.js';
import type { RegisteredGame } from '../src/game-hub-feature.js';

const mockGame: RegisteredGame = {
  id: 'ttt',
  title: '井字棋',
  icon: '♟️',
  description: '三子连珠',
  commandPrefix: '/井字棋',
  quickStart: '人机',
  menus: [],
  runAction: async () => undefined,
};

function cmd(pattern: string, desc: string[], detail?: string): CommandHelpSource {
  return { pattern, helpInfo: { desc: detail ? [desc[0]!, detail] : desc } };
}

describe('command-help', () => {
  it('lists group-suite commands with desc labels', () => {
    const commands: CommandHelpSource[] = [
      cmd('checkin', ['签到', '每日签到获得积分']),
      cmd('rank', ['积分排行', '查看积分排行榜']),
      cmd('/战绩', ['查看本人在本群的游戏战绩']),
    ];
    const text = formatSupplementaryCommandsHelp(commands, [mockGame]);
    expect(text).toContain('`checkin`');
    expect(text).not.toContain('`/checkin`');
    expect(text).toContain('`rank`');
    expect(text).toContain('`/战绩`');
    expect(text).toContain('签到');
  });

  it('preserves pattern prefix style (no forced slash)', () => {
    const text = formatSupplementaryCommandsHelp(
      [cmd('stats', ['群消息统计', '今日发言排行'])],
      [],
    );
    expect(text).toContain('`stats`');
    expect(text).not.toContain('`/stats`');
  });

  it('shows full command pattern without ellipsis', () => {
    const text = formatSupplementaryCommandsHelp(
      [cmd('teach-regex <pattern:text>', ['教我正则问答', '用正则匹配'])],
      [],
    );
    expect(text).toContain('`teach-regex <pattern:text>`');
    expect(text).not.toContain('…');
  });

  it('excludes hub meta and per-game commands already in lobby', () => {
    const commands: CommandHelpSource[] = [
      cmd('/帮助', ['机器人帮助']),
      cmd('/游戏', ['游戏大厅']),
      cmd('/井字棋 [action:word]', ['井字棋']),
      cmd('stats', ['群消息统计']),
    ];
    const items = collectSupplementaryCommandHelp(commands, [mockGame]);
    expect(items.map((c) => c.pattern)).toEqual(['stats']);
  });

  it('filterHelpCommands drops owner-private commands in group chat', async () => {
    const approve = new MessageCommand('/approve list')
      .desc('Owner：列出 bash 永久放行与正则规则')
      .permit('role(master)', 'private(*)')
      .action(async () => 'ok');
    const open = new MessageCommand('stats').desc('统计').action(async () => 'ok');

    const groupMessage = {
      $adapter: 'qq',
      $sender: { id: 'u1', isMaster: true },
      $endpoint: 'zhin',
      $channel: { id: 'g1', type: 'group' },
    } as never;

    const plugin = {
      contextIsReady: () => true,
      inject: () => ({
        check: async (name: string, msg: { $channel?: { type?: string }; $sender?: { isMaster?: boolean } }) => {
          if (name === 'role(master)') return !!msg.$sender?.isMaster;
          if (name === 'private(*)') return msg.$channel?.type === 'private';
          return false;
        },
      }),
    } as never;

    const filtered = await filterHelpCommands([approve, open], groupMessage, plugin);
    expect(filtered.map((c) => c.pattern)).toEqual(['stats']);
  });

  it('filterHelpCommands hides /endpoint commands for regular users', async () => {
    const root = new Plugin('/test/root.ts');
    root.provide(new PermissionFeature());
    const plugin = new Plugin('/test/core.ts', root);
    const commandService = new CommandFeature();
    registerEndpointManagementCommands(plugin, commandService);

    const groupMessage = {
      $adapter: 'qq',
      $sender: { id: 'u1' },
      $endpoint: 'zhin',
      $channel: { id: 'g1', type: 'group' },
    } as never;

    const filtered = await filterHelpCommands(commandService.items, groupMessage, root);
    expect(filtered.some((c) => c.pattern.startsWith('/endpoint'))).toBe(false);
    expect(filtered.some((c) => c.pattern === '/endpoints')).toBe(false);

    const masterMessage = {
      ...groupMessage,
      $sender: { id: 'u1', isMaster: true },
    } as never;
    const masterFiltered = await filterHelpCommands(commandService.items, masterMessage, root);
    expect(masterFiltered.some((c) => c.pattern === '/endpoints')).toBe(true);
    for (const cmd of commandService.items) {
      expect(cmd.requiredPermits).toContain(MANAGEMENT_OPERATOR_PERMIT);
    }
  });

  it('filterHelpCommands drops permit-gated commands for current message', async () => {
    const open = new MessageCommand('stats').desc('统计').action(async () => 'ok');
    const restricted = new MessageCommand('admin-cmd')
      .desc('管理')
      .permit('adapter(discord)')
      .action(async () => 'ok');

    const message = {
      $adapter: 'qq',
      $sender: { id: 'u1' },
      $endpoint: 'zhin',
      $channel: { id: 'c1', type: 'private' },
    } as never;

    const plugin = {
      contextIsReady: () => true,
      inject: () => ({
        check: async (name: string, msg: { $adapter: string }) =>
          name === 'adapter(discord)' && msg.$adapter === 'discord',
      }),
    } as never;

    const filtered = await filterHelpCommands([open, restricted], message, plugin);
    expect(filtered.map((c) => c.pattern)).toEqual(['stats']);
  });
});
