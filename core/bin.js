#!/usr/bin/env node

'use strict';
const path = require('path');
const fs = require('fs');
const defaultArgv = {
  mode: 'prod',
  entry: 'lib',
  config: 'bot.config',
  init: false,
};
const getValue = (list, key, defaultValue) => {
  const value = list[list.indexOf(key) + 1];
  if (!value || value.startsWith('-')) return defaultValue;
  list.splice(list.indexOf(key) + 1, 1);
  return value;
};
const args = process.argv?.slice(2) || [];
for (const key of args) {
  switch (key) {
    case '--entry':
    case '-e':
      defaultArgv.entry = getValue(args, key, defaultArgv.entry);
      break;
    case '--mode':
    case '-m':
      defaultArgv.mode = getValue(args, key, defaultArgv.mode);
      break;
    case '--config':
    case '-c':
      defaultArgv.config = getValue(args, key, defaultArgv.config);
      break;
    case 'init':
      defaultArgv.init = true;
  }
}
if (defaultArgv.init) {
  fs.writeFileSync(
    path.resolve(process.cwd(), `bot.config.ts`),
    `
import {defineConfig} from 'zhin';
import * as path from 'path';

export default defineConfig((env)=>{
  return {
    adapters:[],
    logLevel:'info',
    bots:[],
    pluginDirs: [path.resolve(__dirname, 'plugins')],
    plugins:[
      'commandParser',
      env.mode==='dev' && 'hmr',
      'pluginManager',
      'setup',
    ].filter(Boolean)
  }
})
`,
  );
  fs.mkdirSync(path.resolve(process.cwd(), `plugins`));
  fs.writeFileSync(path.resolve(process.cwd(), `.env`), ``);
  fs.writeFileSync(path.resolve(process.cwd(), `.env.${defaultArgv.mode}`), ``);
  console.log(`请在.${defaultArgv.mode}.env中配置相应参数后再次调用\`npx zhin -m ${defaultArgv.mode}\` 启动`);
  process.exit(0);
}
const jiti = require('jiti')(__dirname);
jiti(path.resolve(__dirname, defaultArgv.entry)).startAppWorker(
  path.resolve(process.cwd(), defaultArgv.config),
  defaultArgv.mode,
);
