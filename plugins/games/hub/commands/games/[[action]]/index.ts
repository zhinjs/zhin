import { defineCommand } from 'zhin.js/command';
import { gameFeatureId, type GameIndex } from '@zhin.js/game-kit';
import { createMessages } from 'zhin.js/i18n';

const messages = createMessages({
  start: { 'zh-CN': '发送 `{command}` 开始 {title}', en: 'Send `{command}` to start {title}' },
});

export default defineCommand({
  description: '游戏大厅：列出已加载的游戏',
  descriptionI18n: { en: 'Game hub: list loaded games' },
  alias: ['游戏', '游戏列表'],
  preferredAliasI18n: { 'zh-CN': '游戏' },
  params: { action: { type: 'string', default: '' } },
  async execute({ params, project, locale, formatCommand }) {
    const games = project<GameIndex>(gameFeatureId);
    const action = String(params.action ?? '').trim();
    if (action) {
      const game = games.get(action);
      if (game) {
        const command = games.formatCommand(game.id, formatCommand);
        const quickStart = game.quickStartI18n?.[locale] ?? game.quickStart;
        const start = quickStart ? ` ${quickStart}` : '';
        if (command) return messages(locale, 'start', { command: command + start,
          title: game.titleI18n?.[locale] ?? game.title });
      }
    }
    return games.formatHelp(locale, formatCommand);
  },
});
