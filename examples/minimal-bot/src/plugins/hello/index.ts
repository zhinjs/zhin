import { usePlugin, MessageCommand, segment } from 'zhin.js';
import { buildStatusCard } from '../status-card.js';

const plugin = usePlugin();
const { addCommand } = plugin;

addCommand(
  new MessageCommand('hello')
    .desc('Stable 路径 smoke：非 AI 命令')
    .action(() =>
      [
        'Hello from minimal-bot.',
        '试试 card 查看 JSX 状态卡片。',
        '启用 AI：npx zhin setup --ai，然后在 Sandbox 发 ai: 你好',
      ].join('\n'),
    ),
);

addCommand(
  new MessageCommand('card')
    .desc('示例状态卡片（@zhin.js/satori JSX）')
    .usage('card')
    .action(() => {
      const mem = process.memoryUsage();
      const html = buildStatusCard('minimal-bot', [
        { label: 'RSS', value: `${Math.round(mem.rss / 1024 / 1024)}MB` },
        { label: '堆', value: `${Math.round(mem.heapUsed / 1024 / 1024)}MB` },
      ]);
      return segment.html({ html, width: 540 });
    }),
);

export default plugin;
