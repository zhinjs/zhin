import { Plugin } from 'zhin';
export { default as commandParser } from '@/commandParser';
export { default as echo } from '@/echo';
export { default as hmr } from '@/hmr';
export { default as pluginManager } from '@/pluginManager';
export { default as setup } from '@/setup';
const builtInPlugins = new Plugin({
  name: '内置插件',
  desc: '指令解析、热更新、插件管理、setup支持',
});
builtInPlugins.plugin('commandParser').plugin('echo').plugin('hmr').plugin('pluginManager').plugin('setup');
export default builtInPlugins;
