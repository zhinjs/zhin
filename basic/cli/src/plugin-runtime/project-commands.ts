import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  NodePackageResolver,
  ProjectGraphService,
  type PluginGraphNode,
  type ProjectGraph,
  type ResolvedPackage,
} from '@zhin.js/runtime';
import {
  completeJournal,
  createPublishJournal,
  updateJournalStep,
  type PublishJournal,
  type PublishJournalStore,
} from './publish-journal.js';

export type CommandPhase = 'build' | 'publish' | 'promote' | 'cleanup';

export interface CommandStep {
  readonly id: string;
  readonly packageName: string;
  readonly version?: string;
  readonly phase: CommandPhase;
  readonly tag?: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface ProjectPlan {
  readonly kind: 'build' | 'publish';
  readonly id?: string;
  readonly mode?: 'dry-run' | 'execute';
  readonly targetTag?: string;
  readonly stagingTag?: string;
  readonly steps: readonly CommandStep[];
}

export interface ProcessRunner {
  run(step: CommandStep): Promise<void>;
  probe?(step: CommandStep): Promise<'complete' | 'incomplete' | 'unknown'>;
}

export class NodeProcessRunner implements ProcessRunner {
  run(step: CommandStep): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(step.command, step.args, {
        cwd: step.cwd,
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${step.packageName} command exited with ${code}`));
      });
    });
  }

  async probe(step: CommandStep): Promise<'complete' | 'incomplete' | 'unknown'> {
    if (!step.version || !step.tag || step.phase === 'build') return 'unknown';
    if (step.phase === 'publish') {
      const result = await capture('pnpm', ['view', `${step.packageName}@${step.version}`, 'version', '--json'], step.cwd);
      if (result.code === 0) return parseJson(result.stdout) === step.version ? 'complete' : 'unknown';
      return /E404|404 Not Found/iu.test(result.stderr) ? 'incomplete' : 'unknown';
    }
    const result = await capture('pnpm', ['view', step.packageName, 'dist-tags', '--json'], step.cwd);
    if (result.code !== 0) return 'unknown';
    const tags = parseJson(result.stdout);
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return 'unknown';
    const value = (tags as Record<string, unknown>)[step.tag];
    if (step.phase === 'promote') return value === step.version ? 'complete' : 'incomplete';
    return value === undefined ? 'complete' : 'incomplete';
  }
}

export class ProjectCommands {
  async inspect(root: string): Promise<ProjectGraph> {
    const resolver = await NodePackageResolver.create(root);
    return new ProjectGraphService(resolver).inspect(root);
  }

  buildPlan(graph: ProjectGraph): ProjectPlan {
    return Object.freeze({
      kind: 'build',
      steps: Object.freeze(graph.buildOrder.flatMap((pkg) => {
        if (pkg.source !== 'workspace' || !pkg.packageJson.scripts?.build) return [];
        return [step(pkg, 'build', ['run', 'build'])];
      })),
    });
  }

  publishPlan(
    graph: ProjectGraph,
    options: boolean | { readonly execute?: boolean; readonly tag?: string } = false,
  ): ProjectPlan {
    validatePublicDependencies(graph);
    const execute = typeof options === 'boolean' ? options : options.execute ?? false;
    const targetTag = typeof options === 'boolean' ? 'latest' : options.tag ?? 'latest';
    assertDistTag(targetTag);
    const packages = graph.buildOrder.filter(
      (pkg) => pkg.source === 'workspace' && !pkg.packageJson.private,
    );
    const id = publishPlanId(packages, targetTag);
    const stagingTag = `zhin-txn-${id.slice(0, 12)}`;
    const publish = packages.map((pkg) => {
      const args = ['publish', '--no-git-checks'];
      if (execute) args.push('--tag', stagingTag);
      else args.push('--dry-run');
      return step(pkg, 'publish', args, execute ? stagingTag : undefined);
    });
    const promote = execute ? packages.map((pkg) => step(
      pkg,
      'promote',
      ['dist-tag', 'add', `${pkg.name}@${requiredPackageVersion(pkg)}`, targetTag],
      targetTag,
    )) : [];
    const cleanup = execute ? packages.map((pkg) => step(
      pkg,
      'cleanup',
      ['dist-tag', 'rm', pkg.name, stagingTag],
      stagingTag,
    )) : [];
    return Object.freeze({
      kind: 'publish',
      id,
      mode: execute ? 'execute' : 'dry-run',
      targetTag,
      stagingTag,
      steps: Object.freeze([...publish, ...promote, ...cleanup]),
    });
  }

  async execute(plan: ProjectPlan, runner: ProcessRunner): Promise<void> {
    if (plan.kind === 'publish' && plan.mode === 'execute') {
      throw new Error('Executable publish plans require executePublish() and a journal store');
    }
    for (const command of plan.steps) await runner.run(command);
  }

  async executePublish(
    plan: ProjectPlan,
    runner: ProcessRunner,
    store: PublishJournalStore,
    options: { readonly resume?: boolean } = {},
  ): Promise<PublishJournal> {
    if (plan.kind !== 'publish' || plan.mode !== 'execute' || !plan.id) {
      throw new TypeError('executePublish() requires an executable publish plan');
    }
    let journal = await store.read();
    if (journal?.state === 'complete' && journal.planId === plan.id) return journal;
    if (journal && journal.state !== 'complete') {
      if (journal.planId !== plan.id) {
        throw new Error(`Publish journal belongs to another plan: ${journal.planId}`);
      }
      if (journal.targetTag !== plan.targetTag || journal.stagingTag !== plan.stagingTag) {
        throw new Error('Publish journal tags do not match the executable plan');
      }
      if (!options.resume) throw new Error('Incomplete publish journal exists; rerun with --resume');
    } else {
      if (options.resume) throw new Error('No incomplete publish journal to resume');
      journal = createPublishJournal(plan);
      await store.write(journal);
    }

    for (const command of plan.steps) {
      const record = journal.steps.find((candidate) => candidate.id === command.id);
      if (!record) throw new Error(`Publish plan step missing from journal: ${command.id}`);
      if (record.status === 'completed') continue;
      if (options.resume && record.status !== 'pending') {
        const probe = await runner.probe?.(command) ?? 'unknown';
        if (probe === 'unknown') throw new Error(`Cannot safely recover publish step ${command.id}`);
        if (probe === 'complete') {
          journal = updateJournalStep(journal, command.id, { status: 'completed' }, 'active');
          await store.write(journal);
          continue;
        }
      }
      journal = updateJournalStep(journal, command.id, {
        status: 'running',
        attempts: record.attempts + 1,
      }, 'active');
      await store.write(journal);
      try {
        await runner.run(command);
        journal = updateJournalStep(journal, command.id, { status: 'completed' }, 'active');
        await store.write(journal);
      } catch (error) {
        journal = updateJournalStep(journal, command.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }, 'failed');
        await store.write(journal);
        throw error;
      }
    }
    journal = completeJournal(journal);
    await store.write(journal);
    return journal;
  }

  describe(graph: ProjectGraph): unknown {
    return {
      root: describeNode(graph.root),
      buildOrder: graph.buildOrder.map((pkg) => pkg.name),
    };
  }
}

function step(
  pkg: ResolvedPackage,
  phase: CommandPhase,
  args: readonly string[],
  tag?: string,
): CommandStep {
  const version = phase === 'build' ? undefined : requiredPackageVersion(pkg);
  return Object.freeze({
    id: `${phase}:${pkg.name}${version ? `@${version}` : ''}`,
    packageName: pkg.name,
    version,
    phase,
    tag,
    cwd: pkg.root,
    command: 'pnpm',
    args: Object.freeze([...args]),
  });
}

function requiredPackageVersion(pkg: ResolvedPackage): string {
  const version = pkg.packageJson.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new TypeError(`Publishable package ${pkg.name} must declare a version`);
  }
  return version;
}

function publishPlanId(packages: readonly ResolvedPackage[], tag: string): string {
  const identity = packages.map((pkg) => `${pkg.name}@${requiredPackageVersion(pkg)}`).join('\n');
  return createHash('sha256').update(`${tag}\n${identity}`).digest('hex');
}

function assertDistTag(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(value) || /^v?\d+\.\d+\.\d+(?:[-+]|$)/iu.test(value)) {
    throw new TypeError(`Invalid npm dist-tag: ${value}`);
  }
}

function capture(command: string, args: readonly string[], cwd: string): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function describeNode(node: PluginGraphNode): unknown {
  return {
    id: node.id,
    package: node.package.name,
    source: node.package.source,
    features: node.features.map((feature) => feature.package.name),
    children: node.children.map(describeNode),
  };
}

function validatePublicDependencies(graph: ProjectGraph): void {
  for (const pkg of graph.buildOrder) {
    if (pkg.packageJson.private) continue;
    const dependencies = {
      ...pkg.packageJson.dependencies,
      ...pkg.packageJson.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const dependency = graph.packages.get(name);
      if (dependency?.packageJson.private) {
        throw new Error(`Public package ${pkg.name} depends on private package ${name}`);
      }
    }
  }
}
