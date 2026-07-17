#!/usr/bin/env node
import { resolve } from 'node:path';
import { ProjectCommands, NodeProcessRunner } from './project-commands.js';
import { ProjectScaffolder } from './scaffolder.js';

const [command, subject, name, packageName, ...flags] = process.argv.slice(2);
const root = resolve(process.cwd());

try {
  if (command === 'init') {
    await new ProjectScaffolder(root).init({ packageName: subject ?? 'zhin-plugin' });
  } else if (command === 'create' && subject === 'plugin' && name) {
    await new ProjectScaffolder(root).createPlugin({ name, packageName });
  } else if (command === 'create' && subject === 'feature' && name) {
    await new ProjectScaffolder(root).createFeature({ name, packageName });
  } else if (command === 'inspect') {
    const commands = new ProjectCommands();
    process.stdout.write(`${JSON.stringify(commands.describe(await commands.inspect(root)), null, 2)}\n`);
  } else if (command === 'build' || command === 'publish') {
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const executePublish = flags.includes('--execute') || subject === '--execute';
    const plan = command === 'build'
      ? commands.buildPlan(graph)
      : commands.publishPlan(graph, executePublish);
    await commands.execute(plan, new NodeProcessRunner());
  } else {
    throw new Error([
      'Usage:',
      '  zhin-next init [package-name]',
      '  zhin-next create plugin <name> [package-name]',
      '  zhin-next create feature <name> [package-name]',
      '  zhin-next inspect',
      '  zhin-next build',
      '  zhin-next publish [--execute]',
    ].join('\n'));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
