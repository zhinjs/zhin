import { Message, Plugin, WORK_DIR } from '@zhinjs/core';
import { Database } from './types';
import { dbFactories, initFactories } from './factory';
import path from 'path';

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
export interface UserInfo extends Message.Sender {}
const database = new Plugin({
  name: 'database',
  desc: '数据库服务',
  priority: 1,
});
database.mounted(async app => {
  // 获取数据库驱动名称
  const driverName = app.config.db_driver || 'level';
  // 尝试根据驱动名称加载数据库驱动
  await loadDbDriver(driverName);
  // 获取数据库创建工厂函数
  const factoryFn = dbFactories.get(driverName);
  if (!factoryFn) throw new Error(`zhin not found: ${app.config.db_driver} driver`);
  const initArgs = app.config.db_init_args || initFactories.get(driverName) || [];
  database.logger.info(`${driverName} driver starting...`);
  database.logger.debug(`${driverName} driver starting with args`, initArgs);
  // 初始化数据库
  const db: Database = await factoryFn(...initArgs);
  // 启动数据库
  await db.start();
  database.logger.info(`${driverName} driver started`);
  database.service('database', db);
  // 初始化用户、群表
  await db.get('group', []);
  await db.get('user', []);
  app.middleware(async (message, next) => {
    const userInfo = await db.find<UserInfo[]>('user', user => {
      return user.user_id === message.sender.user_id;
    });
    if (!userInfo)
      await db.push('user', {
        user_id: message.sender.user_id,
        user_name: message.sender.user_name,
      });
    Object.assign((message.sender ||= {}), userInfo);
    next();
  });
});
database.beforeUnmount(async app => {
  await app.database.stop();
});
function loadDbDriver(dbName: string) {
  return new Promise<void>((resolve, reject) => {
    const mayBePath = [
      path.join(__dirname, 'adapters', dbName),
      path.join(WORK_DIR, 'node_modules', '@zhinjs', `${dbName}-driver`),
      path.join(WORK_DIR, 'node_modules', `zhin-${dbName}-driver`),
    ];
    for (const loadPath of mayBePath) {
      try {
        require(loadPath);
        return resolve();
      } catch (error) {}
    }
    reject(new Error(`Cannot find driver for ${dbName}`));
  });
}
export default database;
