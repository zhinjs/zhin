import { usePlugin, MessageCommand } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('L4 full-bot smoke：非 AI 命令')
    .action(() => 'Hello from full-bot (L4 reference).'),
);
