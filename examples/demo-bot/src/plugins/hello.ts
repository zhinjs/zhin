import { usePlugin, MessageCommand } from 'zhin.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('Demo smoke：非 AI 命令')
    .action(() => '你好！这是 Zhin.js 官方 Demo。试试 ai: 你好'),
);
