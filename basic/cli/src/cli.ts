#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { stopCommand } from './commands/stop.js';
import { buildCommand } from './commands/build.js';
import { newCommand } from './commands/new.js';
import { pubCommand } from './commands/pub.js';
import { installCommand, addCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { searchCommand, infoCommand } from './commands/search.js';
import { serviceCommand } from './commands/install-service.js';
import { doctorCommand } from './commands/doctor.js';
import { setupCommand } from './commands/setup.js';
import { configCommand } from './commands/config.js';
import { onboardCommand } from './commands/onboard.js';
import { scheduleCommand } from './commands/schedule.js';
import { migrateCommand } from './commands/migrate.js';
import { sendCommand } from './commands/send.js';
import { watchCommand } from './commands/watch.js';
import { packagesCommand } from './commands/packages.js';
import { runtimeCommand } from './commands/runtime.js';
import { traceCommand } from './commands/trace.js';
import { usageCommand } from './commands/usage.js';
import { devCommand } from './commands/dev.js';
import { useCasesCommand } from './commands/use-cases.js';
import { pluginCommand } from './commands/plugin.js';

// src/cli.ts 与 lib/cli.js 都在包根下一层，../package.json 就是 @zhin.js/cli 自己的清单。
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const program = new Command();

program
  .name('zhin')
  .description('Zhin机器人框架CLI工具')
  .version(version);

// 注册命令
program.addCommand(stopCommand);
program.addCommand(buildCommand);
program.addCommand(newCommand);
program.addCommand(pubCommand);
program.addCommand(pluginCommand);
program.addCommand(installCommand);
program.addCommand(addCommand);
program.addCommand(uninstallCommand);
program.addCommand(searchCommand);
program.addCommand(infoCommand);
program.addCommand(serviceCommand);
program.addCommand(doctorCommand);
program.addCommand(setupCommand);
program.addCommand(configCommand);
program.addCommand(onboardCommand);
program.addCommand(scheduleCommand);
program.addCommand(migrateCommand);
program.addCommand(sendCommand);
program.addCommand(watchCommand);
program.addCommand(packagesCommand);
// Agent command handlers use optional AI contracts; IM-only commands must not load them.
const needsAgentCommand = process.argv[2] === 'agent'
  || (process.argv[2] === 'help' && process.argv[3] === 'agent');
program.addCommand(needsAgentCommand
  ? (await import('./commands/agent.js')).agentCommand
  : new Command('agent').description('Agent diagnostics and Workroom operations'));
program.addCommand(runtimeCommand);
program.addCommand(traceCommand);
program.addCommand(usageCommand);
program.addCommand(devCommand);
program.addCommand(useCasesCommand);

try {
  await program.parseAsync();
} catch (error) {
  console.error(`zhin: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
