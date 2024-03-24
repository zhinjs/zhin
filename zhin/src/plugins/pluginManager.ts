import { Plugin, segment } from '@zhinjs/core';

const pluginManager = new Plugin('插件管理');
pluginManager
  .command('插件列表')
  .desc('查看已安装插件')
  .scope('private', 'group', 'guild', 'direct')
  .action(runtime => {
    return segment.text(
      [...pluginManager.app!.pluginList]
        .map((plugin, index) => {
          return `${index + 1} ${plugin.display_name}(${plugin.statusText})`;
        })
        .join('\n'),
    );
  });
pluginManager
  .command('启用插件 [name:string]')
  .permission('admin')
  .scope('direct')
  .action((runtime, name) => {
    const plugin = pluginManager.app!.plugins.get(name);
    if (!plugin) {
      return '该插件不存在';
    }
    plugin.enable();
    return '插件已启用';
  });
pluginManager
  .command('禁用插件 [name:string]')
  .permission('admin')
  .scope('direct')
  .action((runtime, name) => {
    const plugin = pluginManager.app!.plugins.get(name);
    if (!plugin) {
      return '插件不存在';
    }
    plugin.disable();
    return '插件已禁用';
  });
export default pluginManager;
