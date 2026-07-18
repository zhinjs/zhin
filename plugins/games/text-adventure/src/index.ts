export { ADV_HELP } from './adv-command.js';
export { getGameServices, setGameServices } from './runtime-store.js';
export { createInMemoryAdvDb, mountAdvMemoryServices } from './memory-db.js';

/**
 * 已由 plugin.ts 接线：commands/ 命令、middlewares/ 文本与选项中间件、
 * 游戏大厅注册（registerRuntimeGame）、过期会话 cron（scheduleHostToken）、
 * host DatabaseHost（databaseHostToken）。仍未接：interactive 按钮回调。
 */
