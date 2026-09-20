import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '查看当前服务器时间',
  execute: () =>
    `当前时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
});
