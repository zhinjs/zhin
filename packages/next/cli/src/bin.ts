#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { FilePublishJournalStore } from './publish-journal.js';
import { ProjectCommands, NodeProcessRunner } from './project-commands.js';
import { ProjectScaffolder } from './scaffolder.js';

const [command, ...args] = process.argv.slice(2);
const [subject, name, packageName] = args;
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
    if (command === 'build') {
      await commands.execute(commands.buildPlan(graph), new NodeProcessRunner());
    } else {
      const options = parsePublishOptions(args);
      const plan = commands.publishPlan(graph, {
        execute: options.execute || options.resume,
        tag: options.tag,
      });
      const runner = new NodeProcessRunner();
      if (plan.mode === 'execute') {
        await commands.executePublish(
          plan,
          runner,
          new FilePublishJournalStore(join(root, '.zhin/publish-journal.json')),
          { resume: options.resume },
        );
      } else {
        await commands.execute(plan, runner);
      }
    }
  } else {
    throw new Error([
      'Usage:',
      '  zhin-next init [package-name]',
      '  zhin-next create plugin <name> [package-name]',
      '  zhin-next create feature <name> [package-name]',
      '  zhin-next inspect',
      '  zhin-next build',
      '  zhin-next publish [--execute] [--resume] [--tag <tag>]',
    ].join('\n'));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parsePublishOptions(args: readonly string[]): {
  readonly execute: boolean;
  readonly resume: boolean;
  readonly tag?: string;
} {
  let execute = false;
  let resume = false;
  let tag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) break;
    if (argument === '--execute') execute = true;
    else if (argument === '--resume') resume = true;
    else if (argument === '--tag') {
      tag = args[index + 1];
      if (!tag) throw new Error('--tag requires a value');
      index += 1;
    } else if (argument.startsWith('--tag=')) {
      tag = argument.slice('--tag='.length);
    } else {
      throw new Error(`Unknown publish option: ${argument}`);
    }
  }
  return { execute, resume, tag };
}
