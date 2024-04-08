import { Plugin, segment, WORK_DIR } from '@zhinjs/core';
import * as fs from 'fs';
import path from 'path';

const pluginManager = new Plugin('插件管理');
const pluginCommand = pluginManager.command('插件管理');
pluginCommand
  .command('插件列表')
  .desc('查看已安装插件')
  .scope('private', 'group', 'guild', 'direct')
  .action(({ adapter }) => {
    return segment.text(
      [...pluginManager.app!.pluginList]
        .map((plugin, index) => {
          return `${index + 1} ${plugin.display_name}(${plugin.id}) ${plugin.statusText}`;
        })
        .join('\n'),
    );
  });
pluginCommand
  .command('install [name:string]')
  .desc('安装插件')
  .permission('master')
  .action(async ({ message, prompt }, name) => {
    if (!name) name = await prompt.text('请输入插件名或插件仓库地址');
    if (!name) return `输入错误`;
    if (/^https?:\/\//.test(name)) return pluginManager.installPluginFromGit(name);
    return pluginManager.installPluginFromNpm(name);
  });
pluginCommand
  .command('uninstall [name:string]')
  .desc('卸载插件')
  .permission('master')
  .action(async ({ message, prompt }, name) => {
    if (!name) name = await prompt.text('请输入插件名或插件仓库名');
    if (!name) return `输入错误`;
    if (fs.existsSync(path.resolve(WORK_DIR, 'plugins', name))) {
      fs.unlinkSync(path.resolve(WORK_DIR, 'plugins', name));
      return `${name} 已卸载`;
    }
    return pluginManager.uninstallPluginFromNpm(name);
  });
pluginCommand
  .command('启用插件 [name:string]')
  .permission('master')
  .scope('direct')
  .action((runtime, name) => {
    const plugin = pluginManager.app!.plugins.get(name);
    if (!plugin) {
      return '该插件不存在';
    }
    plugin.enable();
    return '插件已启用';
  });
pluginCommand
  .command('禁用插件 [name:string]')
  .permission('admin')
  .scope('direct', 'private')
  .action((runtime, name) => {
    const plugin = pluginManager.app!.plugins.get(name);
    if (!plugin) {
      return '插件不存在';
    }
    plugin.disable();
    return '插件已禁用';
  });
export default pluginManager;
