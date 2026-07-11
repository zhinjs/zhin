/**
 * @zhin.js/plugin-tic-tac-toe — 跨平台井字棋
 *
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-tic-tac-toe"
 * database:
 *   dialect: sqlite
 *   storage: ./data/zhin.db
 * ```
 */
import { formatCompact, usePlugin, type DatabaseFeature } from 'zhin.js';
import { registerModels } from './models.js';
import { createServices, resolveGameDatabase, type SessionServices } from './session-service.js';
import { registerCommands, registerInteractive, registerTextFallback } from './commands.js';
import { registerTttHub } from './hub-register.js';

const plugin = usePlugin();
const { logger, useContext, addSchedule } = plugin;

registerModels(plugin);

let services: SessionServices | null = null;

useContext('database', (dbFeature: DatabaseFeature) => {
  services = createServices(resolveGameDatabase(dbFeature));
  logger.debug(formatCompact({ 模块: '井字棋', 数据模型: '已就绪' }));
});

registerTttHub(() => services);
registerCommands(plugin, () => services);
registerInteractive(plugin, () => services);
registerTextFallback(plugin, () => services);

addSchedule({ kind: 'solar', cron: '0 */10 * * * *' }, async () => {
    if (!services) return;
    const n = await services.session.abortStale(30 * 60 * 1000);
    if (n > 0) logger.debug(formatCompact({ 井字棋: '清理超时局', count: n }));
  });

logger.debug(formatCompact({ 模块: '井字棋', 状态: '已加载' }));
