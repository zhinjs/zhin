import { usePlugin, MessageCommand, segment } from 'zhin.js';
import { buildStatusCard } from './status-card.js';

const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('hello')
    .desc('Demo smoke：非 AI 命令')
    .action(() => '你好！这是 Zhin.js 官方 Demo。试试 ai: 你好'),
);

addCommand(
  new MessageCommand('card')
    .desc('示例状态卡片（@zhin.js/satori JSX）')
    .usage('card')
    .action(() => {
      const mem = process.memoryUsage();
      const html = buildStatusCard('Demo', [
        { label: 'RSS', value: `${Math.round(mem.rss / 1024 / 1024)}MB` },
        { label: '堆', value: `${Math.round(mem.heapUsed / 1024 / 1024)}MB` },
      ]);
      return segment.html({ html, width: 540 });
    }),
);
