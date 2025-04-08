import { watch, FSWatcher } from 'chokidar';
import { Plugin, Adapter, WORK_DIR, App, wrapExport } from '@zhinjs/core';
import * as path from 'path';
import * as fs from 'fs';
import { ProcessMessage, QueueInfo } from '../worker';
const hmr = new Plugin('hmr');
let watcher: FSWatcher;
hmr.beforeUnmount(() => {
  watcher?.close();
});
const hotModuleReplace=((isEsm:boolean)=>{
  return isEsm?async <T>(filePath:string)=>{
    const timestamp = Date.now();
    const moduleUrl = `${filePath}?t=${timestamp}`;
    const { default:obj={},...other } = await import(moduleUrl);
    return Object.assign(obj,other) as T
  }:async <T>(filePath:string)=>{
    delete require.cache[require.resolve(filePath)];
    return require(filePath) as T
  }
})(typeof require === 'undefined' || require.toString().indexOf('native code') > -1)
hmr.mounted(app => {
  const watchPaths = [
    // 只监听本地插件和内置插件的变更，模块的管不了
    ...app.config.plugin_dirs
      .map(dir => {
        return path.resolve(WORK_DIR, dir);
      })
      .filter(dir => !dir.startsWith(path.join(WORK_DIR, 'node_modules'))), // 本地目录插件
    __dirname, // 内置插件
    app.config.filename, // 配置文件
    path.resolve(WORK_DIR, `.${process.env.mode}.env`), // 环境变量
  ].filter(Boolean) as string[];
  watcher = watch(
    watchPaths
      .filter(watchPath => {
        return fs.existsSync(watchPath);
      })
      .map(watchPath => {
        if (watchPath.endsWith('node_modules'))
          return `${watchPath}${path.sep}zhin-plugin-*${path.sep}lib${path.sep}*.{,c,m}[tj]s`;
        if (watchPath.endsWith('@zhinjs'))
          return `${watchPath}${path.sep}plugin-*${path.sep}lib${path.sep}*.{,c,m}[tj]s`;
        return watchPath;
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
    if (filePath.startsWith('.env') || filePath === app.config.filename) reloadProject(path.basename(filePath));
    const pluginFiles = app.pluginList.map(p => p.filePath);
    if (watchPaths.some(watchPath => filePath.startsWith(watchPath)) && pluginFiles.includes(filePath)) {
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
    const { adapter: adapter_name, bot: bot_id, channel, message: content } = message.body;
    const adapter = App.adapters.get(adapter_name);
    const waitBotReady = (bot: Adapter.Bot) => {
      if (bot.unique_id === bot_id) {
        adapter?.sendMsg(bot_id, channel, content);
      }
      adapter?.off('bot-ready', waitBotReady);
    };
    adapter?.on('bot-ready', waitBotReady);
  }
});
hmr
  .command('zhin.restart')
  .desc('重启项目')
  .permission('master')
  .action(async ({ message }) => {
    await message.reply('正在重启');
    process.send?.({
      type: 'queue',
      body: {
        adapter: message.adapter.name,
        bot: message.bot.unique_id,
        channel: message.channel,
        message: `已完成重启`,
      } as QueueInfo,
    });
    process.exit(51);
  });
hmr
  .command('zhin.exit')
  .desc('退出zhin')
  .permission('master')
  .action(async ({ message }) => {
    await message.reply('正在退出');
    process.exit();
  });
export default hmr;
