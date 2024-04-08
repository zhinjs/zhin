import { watch, FSWatcher } from 'chokidar';
import { App, wrapExport, Plugin, WORK_DIR, Bot } from '@zhinjs/core';
import * as path from 'path';
import * as fs from 'fs';
import { ProcessMessage, QueueInfo } from '../worker';

const hmr = new Plugin('hmr');
let watcher: FSWatcher;
hmr.unmounted(() => {
  watcher?.close();
});
hmr.mounted(app => {
  const configFiles = [
    `${process.env.cofnig}.js`,
    `${process.env.config}.ts`,
    `${process.env.cofnig}.cjs`,
    `${process.env.config}.mts`,
  ].filter(filePath => fs.existsSync(filePath));
  const watchDirs = [
    // 只监听本地插件和内置插件的变更，模块的管不了
    ...(app.config.plugin_dirs || []).map(dir => {
      return path.resolve(WORK_DIR, dir);
    }), // 本地目录插件
    __dirname, // 内置插件
    ...configFiles,
    path.resolve(WORK_DIR, `.${process.env.mode}.env`), // 环境变量
  ].filter(Boolean);
  watcher = watch(
    watchDirs.filter(p => {
      return fs.existsSync(p);
    }),
  );
  const reloadProject = (filename: string) => {
    app.logger.info(`\`${filename}\` changed restarting ...`);
    return process.exit(51);
  };
  const reloadPlugin = (filePath: string, plugin: Plugin) => {
    app.logger.debug(`plugin：${plugin.display_name} changed`);
    const oldCache = require.cache[filePath];
    if (plugin === hmr) watcher.close();
    app.unmount(plugin);
    delete require.cache[filePath];
    try {
      app.mount(filePath);
    } catch (e) {
      require.cache[filePath] = oldCache;
      app.mount(filePath);
    }
  };
  const reloadPlugins = (filePath: string) => {
    const plugins = app.pluginList.filter(p => p.filePath === filePath);
    if (!plugins.length) return;
    for (const plugin of plugins) {
      reloadPlugin(filePath, plugin);
    }
  };

  const changeListener = (filePath: string) => {
    if (filePath.startsWith('.env')) {
      return reloadProject(filePath.replace(path.dirname(filePath) + '/', ''));
    }
    const pluginFiles = app.pluginList.map(p => p.filePath);
    if (watchDirs.some(dir => filePath.startsWith(dir)) && pluginFiles.includes(filePath)) {
      return reloadPlugins(filePath);
    }
  };
  watcher.on('change', changeListener);
});
hmr.on('start', () => {
  process.send?.({
    type: 'start',
  });
});
process.on('message', (message: ProcessMessage) => {
  if (message.type === 'queue') {
    const { adapter: adapter_name, bot: bot_id, target_id, target_type, message: content } = message.body;
    const adapter = hmr.app?.adapters.get(adapter_name);
    const waitBotReady = (bot: Bot<any>) => {
      console.log(bot_id);
      if (bot.unique_id === bot_id) {
        adapter?.sendMsg(bot_id, target_id, target_type, content);
      }
      adapter?.off('bot-ready', waitBotReady);
    };
    adapter?.on('bot-ready', waitBotReady);
  }
});
hmr
  .command('restart')
  .desc('重启项目')
  .permission('master')
  .action(async ({ bot, adapter, message }) => {
    await message.reply('正在重启');
    process.send?.({
      type: 'queue',
      body: {
        adapter: adapter.name,
        bot: bot.unique_id,
        target_id: message.from_id,
        target_type: message.message_type,
        message: `已完成重启`,
      } as QueueInfo,
    });
    process.exit(51);
  });
export default hmr;
