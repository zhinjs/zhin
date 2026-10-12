import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '直接返回 JSX',
  execute: () => <>JSX ready：来自命令<button onClick={() => <text>按钮回复</text>}>查看回复</button></>,
});
