import dotEnv from 'dotenv';
import { fork, ForkOptions } from 'child_process';
import path from 'path';
import * as fs from 'fs';
import { deepMerge } from '@/utils';
import process from 'process';
import { WORK_DIR } from '@/constans';
interface Message {
  type: 'start' | 'queue';
  body: any;
}

let buffer: any = null,
  timeStart: number;
const readEnv = (filename: string) => {
  if (fs.existsSync(filename)) {
    return dotEnv.config({ path: filename }).parsed || {};
  }
  return {};
};
export function startAppWorker(config: string, mode: string) {
  const commonEnv = readEnv(path.join(WORK_DIR, '.env'));
  const modeEnv = deepMerge(commonEnv, readEnv(path.join(WORK_DIR, `.env.${mode}`)));
  const forkOptions: ForkOptions = {
    env: {
      ...process.env,
      mode,
      config,
      ...modeEnv,
      PWD: WORK_DIR,
    },
    execArgv: ['-r', 'jiti/register', '-r', 'tsconfig-paths/register'],
    stdio: 'inherit',
  };
  const cp = fork(path.resolve(__dirname, '../start.js'), ['-p tsconfig.json'], forkOptions);
  cp.on('message', (message: Message) => {
    if (message.type === 'start') {
      if (buffer) {
        cp.send({ type: 'send', body: buffer, times: timeStart });
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
    timeStart = new Date().getTime();
    startAppWorker(config, mode);
  });
}
