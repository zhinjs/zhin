import { createMessages } from '@zhin.js/plugin-runtime';

export const gameMessages = createMessages({
  chooseNumber: { 'zh-CN': '回复数字选择', en: 'Reply with a number to choose' },
  lobby: { 'zh-CN': '🎮 游戏大厅', en: '🎮 Game lobby' },
  noGames: { 'zh-CN': '暂无已加载的游戏插件。', en: 'No game plugins are loaded.' },
  installGame: { 'zh-CN': '安装并启用 `@zhin.js/plugin-guess-number` 等游戏包后重试。', en: 'Install and enable a game package such as `@zhin.js/plugin-guess-number`, then try again.' },
  loaded: { 'zh-CN': '已加载：', en: 'Loaded:' },
  startHint: { 'zh-CN': '发送对应命令开始；进行中可按各游戏说明直接回复。', en: 'Send a listed command to start; follow the game instructions to reply during play.' },
  conflict: { 'zh-CN': '你在当前频道已有进行中的「{active}」对局，请先结束它，再开始「{requested}」。', en: 'You already have an active “{active}” game in this channel. Finish it before starting “{requested}”.' },
  stale: { 'zh-CN': '{icon} {title}对局因长时间无操作已结束。', en: '{icon} The {title} game ended due to inactivity.' },
});
