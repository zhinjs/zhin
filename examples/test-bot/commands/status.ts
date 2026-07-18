import { defineCommand } from '@zhin.js/command';
import * as os from 'node:os';

export default defineCommand({
  description: '进程 / 主机简况',
  execute: () => {
    const uptimeMin = Math.floor(process.uptime() / 60);
    return [
      '📟 status (Plugin Runtime)',
      `node: ${process.version}`,
      `pid: ${process.pid}`,
      `uptime: ${uptimeMin}m`,
      `platform: ${os.platform()} ${os.release()}`,
      `cpus: ${os.cpus().length}`,
      `cwd: ${process.cwd()}`,
    ].join('\n');
  },
});
