import { spawn } from 'node:child_process';
import {
  NodePackageResolver,
  ProjectGraphService,
  type PluginGraphNode,
  type ProjectGraph,
  type ResolvedPackage,
} from '@zhin.js/next-runtime';

export interface CommandStep {
  readonly packageName: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface ProjectPlan {
  readonly kind: 'build' | 'publish';
  readonly steps: readonly CommandStep[];
}

export interface ProcessRunner {
  run(step: CommandStep): Promise<void>;
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
        return [step(pkg, ['run', 'build'])];
      })),
    });
  }

  publishPlan(graph: ProjectGraph, execute = false): ProjectPlan {
    validatePublicDependencies(graph);
    return Object.freeze({
      kind: 'publish',
      steps: Object.freeze(graph.buildOrder.flatMap((pkg) => {
        if (pkg.source !== 'workspace' || pkg.packageJson.private) return [];
        const args = ['publish', '--no-git-checks'];
        if (!execute) args.push('--dry-run');
        return [step(pkg, args)];
      })),
    });
  }

  async execute(plan: ProjectPlan, runner: ProcessRunner): Promise<void> {
    for (const command of plan.steps) await runner.run(command);
  }

  describe(graph: ProjectGraph): unknown {
    return {
      root: describeNode(graph.root),
      buildOrder: graph.buildOrder.map((pkg) => pkg.name),
    };
  }
}

function step(pkg: ResolvedPackage, args: readonly string[]): CommandStep {
  return Object.freeze({
    packageName: pkg.name,
    cwd: pkg.root,
    command: 'pnpm',
    args: Object.freeze([...args]),
  });
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
