import { defineCommand } from 'zhin.js/command';

/** whoami —— 展示命令上下文里的插件实例视图与配置 */
export default defineCommand<{ greeting: string }, string>({
  description: '显示当前插件实例与生效配置',
  execute({ config }) {
    return `实例: capabilities-bot\ngreeting: ${config.greeting}`;
  },
});
