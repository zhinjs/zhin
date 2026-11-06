import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';

export default definePlugin({
  name: 'single-file-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: '打招呼',
      execute: () => 'Hello from single-file-bot! 👋 (试试发送 /status 查看运行状态)',
    }));
    addCommand('status', defineCommand({
      description: '查看运行状态',
      execute: () => {
        const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const uptimeSec = Math.round(process.uptime());
        return `single-file-bot 运行中 | RSS ${rssMb}MB | Uptime ${uptimeSec}s`;
      },
    }));
  },
});
