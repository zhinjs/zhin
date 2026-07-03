/**
 * @zhin.js/plugin-text-adventure — 交互式文字冒险
 *
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-text-adventure"
 * database:
 *   dialect: sqlite
 *   storage: ./data/zhin.db
 * ```
 */
import { formatCompact, usePlugin, type DatabaseFeature } from 'zhin.js';
import { registerModels } from './models.js';
import {
  createServices,
  resolveGameDatabase,
  type GameServices,
} from './session-service.js';
import { registerCommands, registerInteractive, registerTextFallback } from './commands.js';
import { registerAdvHub } from './hub-register.js';

const plugin = usePlugin();
const { logger, useContext, addSchedule } = plugin;

registerModels(plugin);

let services: GameServices | null = null;

useContext('database', (dbFeature: DatabaseFeature) => {
  services = createServices(resolveGameDatabase(dbFeature));
  logger.info(formatCompact({ 模块: '文字冒险', 数据模型: '已就绪' }));
});

registerAdvHub(() => services);
registerCommands(plugin, () => services);
registerInteractive(plugin, () => services);
registerTextFallback(plugin, () => services);

addSchedule({ kind: 'solar', cron: '0 */15 * * * *' }, async () => {
    if (!services) return;
    const n = await services.sessions.abortStale(60 * 60 * 1000);
    if (n > 0) logger.debug(formatCompact({ 文字冒险: '清理超时局', count: n }));
  });

logger.info(formatCompact({ 模块: '文字冒险', 状态: '已加载' }));
