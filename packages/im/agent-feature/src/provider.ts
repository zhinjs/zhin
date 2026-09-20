import { dirname, join } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import {
  defineFeatureProvider,
  type DiscoveryHost,
  type SourceConvention,
} from '@zhin.js/feature-kit';
import { AgentIndex } from './agent-index.js';
import { parseAgentPackage, type AgentResource } from './definition.js';

export const agentFeatureId = featureId('zhin.agent');

const agentPackages: SourceConvention = {
  id: 'agent-package',
  async *discover(context) {
    const root = join(context.packageRoot, 'agents');
    const entries = [...await context.host.list(root)]
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.kind !== 'directory' || !isAgentName(entry.name)) continue;
      const directory = join(root, entry.name);
      const children = await context.host.list(directory);
      if (!children.some((child) => child.kind === 'file' && child.name === 'agent.json')) continue;
      const relatedSources = [
        ...children
          .filter((child) => child.kind === 'file' && child.name !== 'agent.json')
          .map((child) => join(directory, child.name)),
        ...await discoverResourceSources(context.host, directory),
      ];
      yield {
        localName: entry.name,
        source: join(directory, 'agent.json'),
        relatedSources: Object.freeze(relatedSources),
        target: 'server',
      };
    }
  },
  async load(source, context) {
    const directory = dirname(source.source);
    const manifest = JSON.parse(await context.host.readText(source.source)) as unknown;
    const files = await readRootFiles(context.host, directory);
    return {
      manifest,
      files,
      workflows: await readResourceDirectory(context.host, directory, 'workflows'),
      tools: await readResourceDirectory(context.host, directory, 'tools'),
      knowledge: await readResourceDirectory(context.host, directory, 'knowledge'),
    };
  },
};

async function discoverResourceSources(host: DiscoveryHost, directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const name of ['workflows', 'tools', 'knowledge'] as const) {
    for (const entry of await host.list(join(directory, name))) {
      if (entry.kind === 'file' && isResourceFile(entry.name)) result.push(join(directory, name, entry.name));
    }
  }
  return result;
}

const agentFeature = defineFeatureProvider({
  protocol: 1,
  id: agentFeatureId,
  authoring: {
    conventions: [agentPackages],
    validate: parseAgentPackage,
  },
  runtime: {
    project(slots, context) {
      return { value: new AgentIndex(slots, context.snapshot) };
    },
  },
});

async function readRootFiles(host: DiscoveryHost, directory: string): Promise<Readonly<Record<string, string>>> {
  const entries = await host.list(directory);
  const files = await Promise.all(entries
    .filter((entry) => entry.kind === 'file' && entry.name !== 'agent.json')
    .map(async (entry) => [entry.name, await host.readText(join(directory, entry.name))] as const));
  return Object.freeze(Object.fromEntries(files));
}

async function readResourceDirectory(
  host: DiscoveryHost,
  agentDirectory: string,
  name: 'workflows' | 'tools' | 'knowledge',
): Promise<readonly AgentResource[]> {
  const directory = join(agentDirectory, name);
  const entries = [...await host.list(directory)]
    .filter((entry) => entry.kind === 'file' && isResourceFile(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(entries.map(async (entry) => Object.freeze({
    path: `${name}/${entry.name}`,
    content: await host.readText(join(directory, entry.name)),
  })));
}

function isAgentName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isResourceFile(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:md|txt|json|ya?ml|csv|sh)$/u.test(value);
}

export { agentFeature };
export default agentFeature;
