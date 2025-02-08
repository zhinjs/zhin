import dotEnv from 'dotenv';
import { fork, ChildProcess, ForkOptions } from 'child_process';
import path from 'path';
import * as fs from 'fs';
import { Message, WORK_DIR } from '@zhinjs/core';
import { deepMerge, Dict } from '@zhinjs/shared';

export type ProcessMessage = StartMessage | QueueMessage | WorkerMessage | CallMessage;
type StartMessage = {
  type: 'start';
};
type CallMessage = {
  type: 'call';
  body: {
    worker_id: string;
    method: string;
    args: any[];
  };
};
type WorkerMessage = {
  type: 'create_worker';
  body: WorkerInfo;
};
type WorkerInfo = {
  worker_id: string;
  filename: string;
  args?: string[];
};
type QueueMessage = {
  type: 'queue';
  body: QueueInfo;
};
export type QueueInfo = {
  adapter: string;
  bot: string;
  channel: Message.Channel;
  message: string;
};
declare module global {
  namespace NodeJS {
    interface ProcessEnv extends Dict<string> {
      PWD: string;
      ZHIN_KEY: string;
      START_TIME: string;
      RESTART_TIMES: string;
    }
  }
}
let buffer: any = null;
const readEnv = (filename: string) => {
  if (fs.existsSync(filename)) {
    return dotEnv.config({ path: filename }).parsed || {};
  }
  return {};
};
export class Zhin {
  restart_times: number = 0;
  start_time: number = Date.now() / 1000 - process.uptime();
  processMap: Map<string, ChildProcess> = new Map();
  constructor() {}
  startAppWorker(key: string, mode: string, init = false) {
    const commonEnv = readEnv(path.join(WORK_DIR, '.env'));
    const modeEnv = deepMerge(commonEnv, readEnv(path.join(WORK_DIR, `.env.${mode}`)));
    const execArgv = [];
    if (['dev', 'development'].includes(mode)) execArgv.push('-r', 'jiti/register', '-r', 'tsconfig-paths/register');
    const forkOptions: ForkOptions = {
      env: {
        ...process.env,
        mode,
        ZHIN_KEY: key,
        init: init ? '1' : '0',
        ...modeEnv,
        PWD: WORK_DIR,
        START_TIME: this.start_time + '',
        RESTART_TIMES: this.restart_times + '',
      } as NodeJS.ProcessEnv,
      execArgv,
      stdio: 'inherit',
    };
    const cp = fork(path.resolve(__dirname, `./start${path.extname(__filename)}`), ['-p tsconfig.json'], forkOptions);

    cp.on('message', (message: ProcessMessage) => {
      switch (message.type) {
        case 'create_worker':
          const { worker_id, filename, args } = message.body;
          if (this.processMap.has(worker_id)) return cp.send({ type: 'worker', body: worker_id });
          const worker = fork(filename, args, forkOptions);
          this.processMap.set(worker_id, worker);
          break;
        case 'queue':
          buffer = message.body;
          break;
        case 'start':
          if (buffer) {
            cp.send({ type: 'queue', body: buffer });
            buffer = null;
          }
          break;
        default:
          break;
      }
    });
    cp.on('exit', code => {
      if (!code) return;
      if (code !== 51) {
        process.exit(code);
      }
      this.restart_times++;
      this.processMap.delete('app');
      this.startAppWorker(key, mode, init);
    });
    this.processMap.set('app', cp);
  }
  async start(key: string, mode: string, init = false) {
    this.startAppWorker(key, mode, init);
  }
}
export function createZhin() {
  return new Zhin();
}
