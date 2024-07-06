import { Plugin } from '@zhinjs/core';
import { Database } from './types';
import { dbFactories, initFactories } from './factory';

export { LevelDb } from './adapters/level';
export { RedisDb } from './adapters/redis';
declare module '@zhinjs/core' {
  namespace App {
    interface Services {
      database: Database;
    }
    interface Config {
      db_driver: string;
      db_init_args: any[];
    }
  }
}
const database = new Plugin({
  name: 'database',
  desc: '数据库服务',
  priority: 1,
});
database.mounted(async app => {
  // 获取数据库驱动名称
  const driverName = app.config.db_driver || 'level';
  // 获取数据库创建工厂函数
  const factoryFn = dbFactories.get(driverName);
  if (!factoryFn) throw new Error(`zhin not found: ${app.config.db_driver} driver`);
  const initArgs = app.config.db_init_args || initFactories.get(driverName) || [];
  // 初始化数据库
  database.logger.info(`${driverName} driver starting...`);
  database.logger.debug(`${driverName} driver starting with args`, initArgs);
  const db = await factoryFn(...initArgs);
  await db.start();
  database.logger.info(`${driverName} driver started`);
  database.service('database', db);
});
database.beforeUnmount(async app => {
  await app.database.stop();
});
export default database;
