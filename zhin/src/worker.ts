import dotEnv from 'dotenv';
import { fork, ForkOptions } from 'child_process';
import path from 'path';
import * as fs from 'fs';
import { deepMerge, WORK_DIR, Dict } from '@zhinjs/core';
export type ProcessMessage = StartMessage | QueueMessage;
type StartMessage = {
  type: 'start';
};
type QueueMessage = {
  type: 'queue';
  body: QueueInfo;
};
export type QueueInfo = {
  adapter: string;
  bot: string;
  target_id: string;
  target_type: string;
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
let buffer: any = null,
  restart_times: number = 0,
  start_time = Date.now() / 1000 - process.uptime();
const readEnv = (filename: string) => {
  if (fs.existsSync(filename)) {
    return dotEnv.config({ path: filename }).parsed || {};
  }
  return {};
};
export function startAppWorker(key: string, mode: string, init = false) {
  const commonEnv = readEnv(path.join(WORK_DIR, '.env'));
  const modeEnv = deepMerge(commonEnv, readEnv(path.join(WORK_DIR, `.env.${mode}`)));
  const forkOptions: ForkOptions = {
    env: {
      ...process.env,
      mode,
      ZHIN_KEY: key,
      init: init ? '1' : '0',
      ...modeEnv,
      PWD: WORK_DIR,
      START_TIME: start_time + '',
      RESTART_TIMES: restart_times + '',
    } as NodeJS.ProcessEnv,
    execArgv: ['-r', 'esbuild-register/dist/node', '-r', 'tsconfig-paths/register'],
    stdio: 'inherit',
  };
  const cp = fork(path.resolve(__dirname, `./start${path.extname(__filename)}`), ['-p tsconfig.json'], forkOptions);
  cp.on('message', (message: ProcessMessage) => {
    if (message.type === 'start') {
      if (buffer) {
        cp.send({ type: 'queue', body: buffer });
        buffer = null;
      }
    } else if (message.type === 'queue') {
      buffer = message.body;
    }
  });
  cp.on('exit', code => {
    if (!code) return;
    if (code !== 51) {
      process.exit(code);
    }
    restart_times++;
    startAppWorker(key, mode, init);
  });
}
