import { defineCommand } from 'zhin.js/command';
import { messageGatewayToken } from 'zhin.js/core/runtime';
import { definePlugin } from 'zhin.js/plugin-runtime';

const hello = defineCommand({
  description: '打招呼',
  execute: () => [
    'Hello from single-file-bot!',
    '一个 bot.ts 就是一个机器人。',
  ].join('\n'),
});

export default definePlugin({
  name: 'single-file-bot',
  metadata: {
    displayName: 'Single File Bot',
  },
  setup({ resources }) {
    const gateway = resources.use(messageGatewayToken);
    // 单文件没有 commands/ 约定目录（CommandIndex 为空，命令不会被自动路由），
    // 这里用 Host 的 unmatched 回退把 hello 路由到上面的 defineCommand。
    // 需要完整命令路由（子命令、参数、帮助）时，改用 commands/hello.ts 约定式布局。
    gateway.setUnmatchedHandler(async (message) => {
      const input = message.content.trim().replace(/^\//, '');
      if (input !== 'hello') return false;
      // 该命令不读取 CommandContext，直接以空调用。
      const reply = await hello.execute({} as never);
      await message.$reply(String(reply));
      return true;
    });
  },
});
