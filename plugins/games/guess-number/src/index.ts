import { formatCompact, usePlugin, type DatabaseFeature } from 'zhin.js';
import { registerModels } from './models.js';
import {
  createServices,
  resolveGameDatabase,
  type SessionService,
} from './session-service.js';
import { registerCommands, registerGuessMiddleware } from './commands.js';
import { registerGuessHub } from './hub-register.js';

const plugin = usePlugin();
const { logger, useContext, addSchedule } = plugin;

registerModels(plugin);

let services: SessionService | null = null;

useContext('database', (dbFeature: DatabaseFeature) => {
  services = createServices(resolveGameDatabase(dbFeature));
  logger.info(formatCompact({ 模块: '猜数字', 数据模型: '已就绪' }));
});

registerGuessHub(() => services);
registerCommands(plugin, () => services);
registerGuessMiddleware(plugin, () => services);

addSchedule({ kind: 'solar', cron: '0 */15 * * * *' }, async () => {
    if (!services) return;
    const n = await services.abortStale(30 * 60 * 1000);
    if (n > 0) logger.debug(formatCompact({ 猜数字: '清理超时局', count: n }));
  });

logger.info(formatCompact({ 模块: '猜数字', 状态: '已加载' }));
