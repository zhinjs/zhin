import { usePlugin, MessageCommand } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('Stable 路径 smoke：非 AI 命令')
    .action(() => 'Hello from minimal-bot.'),
);
