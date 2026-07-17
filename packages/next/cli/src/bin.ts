#!/usr/bin/env node
import { join, relative, resolve } from 'node:path';
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
  } else if (command === 'migrate') {
    const migration = parseMigrationCommand(args);
    const migrationApi = await import('./migrate/index.js');
    if (migration.phase === 'cutover') {
      const cutover = new migrationApi.PackageCutover();
      const plan = await cutover.plan(root);
      process.stdout.write(`${JSON.stringify({
        changed: plan.changed,
        capabilities: plan.capabilities,
        entry: relativePath(root, plan.entryFile),
        dependencies: plan.dependencies,
      }, null, 2)}\n`);
      if (migration.mode === 'write') await cutover.apply(plan);
    } else {
      const migrator = new migrationApi.LegacyCapabilityMigrator();
      const plan = await migrator.plan(root);
      const summary = migrator.summarize(plan);
      process.stdout.write(`${JSON.stringify({
        summary,
        changes: plan.changes.map((change) => ({
          kind: change.kind,
          identity: change.identity,
          source: relativePath(root, change.source),
          target: relativePath(root, change.target),
          pattern: change.pattern,
        })),
        diagnostics: plan.diagnostics.map((item) => ({
          ...item,
          source: relativePath(root, item.source),
        })),
      }, null, 2)}\n`);
      if (migration.mode === 'write') await migrator.apply(plan);
      if (summary.errors > 0) process.exitCode = 1;
    }
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
      '  zhin-next migrate --check|--write',
      '  zhin-next migrate cutover --check|--write',
      '  zhin-next build',
      '  zhin-next publish [--execute] [--resume] [--tag <tag>]',
    ].join('\n'));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function relativePath(root: string, value: string): string {
  return relative(root, value);
}

function parseMigrationCommand(args: readonly string[]): {
  readonly phase: 'extract' | 'cutover';
  readonly mode: 'check' | 'write';
} {
  const phase = args[0] === 'cutover' ? 'cutover' : 'extract';
  const options = phase === 'cutover' ? args.slice(1) : args;
  if (options.length !== 1 || (options[0] !== '--check' && options[0] !== '--write')) {
    throw new Error('migrate requires [cutover] and exactly one of --check or --write');
  }
  return { phase, mode: options[0] === '--write' ? 'write' : 'check' };
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
