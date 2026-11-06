import { definePage, createDeclarativePage } from '@zhin.js/console-contract';
import type { GameHubConsoleGameRow, GameHubConsoleStatus } from '../../src/console.js';

export const meta = definePage({
  title: '游戏大厅',
  titleI18n: { en: 'Game Hub' },
  icon: 'Gamepad2',
  order: 57,
  requiredPermissions: ['game-hub:read'],
});

export default createDeclarativePage<GameHubConsoleStatus>({
  title: { zh: '游戏大厅', en: 'Game Hub' },
  description: {
    zh: '查看当前已加载的小游戏插件、别名、人数范围与玩法说明',
    en: 'Browse registered mini-game plugins, aliases, player limits, and descriptions',
  },
  stats: [
    {
      key: 'gameCount',
      label: { zh: '已注册游戏数', en: 'Registered Games' },
      value: 'gameCount',
    },
  ],
  sections: [
    {
      id: 'games',
      title: { zh: '已加载游戏', en: 'Registered Games' },
      emptyText: { zh: '暂无已注册的游戏插件', en: 'No game plugins registered' },
      items: 'games',
      columns: [
        {
          key: 'name',
          label: { zh: '游戏名称', en: 'Name' },
        },
        {
          key: 'aliases',
          label: { zh: '别名', en: 'Aliases' },
        },
        {
          key: 'minPlayers',
          label: { zh: '最少人数', en: 'Min Players' },
        },
        {
          key: 'maxPlayers',
          label: { zh: '最多人数', en: 'Max Players' },
        },
        {
          key: 'description',
          label: { zh: '简介', en: 'Description' },
        },
      ] satisfies readonly {
        readonly key: keyof GameHubConsoleGameRow & string;
        readonly label: { readonly zh: string; readonly en: string };
      }[],
    },
  ],
});
