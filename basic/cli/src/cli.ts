#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand, restartCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { newCommand } from './commands/new.js';
import { pubCommand } from './commands/pub.js';
import { installCommand, addCommand } from './commands/install.js';
import { searchCommand, infoCommand } from './commands/search.js';
import { serviceCommand } from './commands/install-service.js';
import { doctorCommand } from './commands/doctor.js';
import { setupCommand } from './commands/setup.js';
import { configCommand } from './commands/config.js';
import { onboardingCommand } from './commands/onboarding.js';
import { skillsCommand } from './commands/skills.js';
import { cronCommand } from './commands/cron.js';

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
program.addCommand(pubCommand);
program.addCommand(installCommand);
program.addCommand(addCommand);
program.addCommand(searchCommand);
program.addCommand(infoCommand);
program.addCommand(serviceCommand);
program.addCommand(doctorCommand);
program.addCommand(setupCommand);
program.addCommand(configCommand);
program.addCommand(onboardingCommand);
program.addCommand(skillsCommand);
program.addCommand(cronCommand);

program.parse(); 