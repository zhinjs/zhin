#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand, restartCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { newCommand } from './commands/new.js';

const program = new Command();

program
  .name('zhin')
  .description('Zhin机器人框架CLI工具')
  .version('1.0.1');

// 注册命令
program.addCommand(startCommand);
program.addCommand(restartCommand);
program.addCommand(stopCommand);
program.addCommand(devCommand);
program.addCommand(buildCommand);
program.addCommand(newCommand);

program.parse(); 