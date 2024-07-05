import { formatDateTime, formatSize, formatTime, Plugin as Plugin, segment } from '@zhinjs/core';
import os from 'os';
import { version } from '../index';
const echo = new Plugin('echo');
echo
  .command('发送 <msg:any>')
  .desc('输出指定信息')
  .permission('master', 'admin', 'admins')
  .alias('echo')
  .action((_, msg) => msg);

echo
  .command('zhin.status')
  .desc('查看知音运行状态')
  .alias('状态')
  .action(({ adapter }) => {
    const restartTimes = Number(process.env?.RESTART_TIMES);
    const lastRestartTime = Date.now() - process.uptime() * 1000;
    const startTime = Date.now() / 1000 - Number(process.env?.START_TIME);
    const cpus = os.cpus();
    const cpuInfo = cpus[0];
    const cpus_model = cpuInfo.model;
    const cpu_speed = cpuInfo.speed;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const processMemory = process.memoryUsage.rss();
    return segment.text(
      [
        `系统架构：${os.type()} ${os.release()} ${os.arch()}`,
        `开机时长：${formatTime(os.uptime())}`,
        `CPU：${cpus.length}核 ${cpus_model}(${cpu_speed}MHz)`,
        `内存：${formatSize(usedMemory)}/${formatSize(totalMemory)} ${((usedMemory / totalMemory) * 100).toFixed(2)}%`,
        `运行环境：NodeJS ${process.version}`,
        `zhin v${version} (${process.env.mode} mode)`,
        `适配器：${adapter.name}`,
        `进程：${process.ppid}/${process.pid} ${formatSize(processMemory)} ${(
          (processMemory / usedMemory) *
          100
        ).toFixed(2)}%`,
        `持续运行：${formatTime(startTime)}`,
        `重启次数：${restartTimes}`,
        `上次重启：${formatDateTime(lastRestartTime)}`,
      ].join('\n'),
    );
  });
export default echo;
