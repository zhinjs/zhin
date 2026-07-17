import { join } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import {
  defineFeatureProvider,
  type SourceConvention,
} from '@zhin.js/feature-kit';
import { AgentIndex } from './agent-index.js';
import { parseAgentMarkdown } from './definition.js';

export const agentFeatureId = featureId('zhin.agent');

const agentFiles: SourceConvention = {
  id: 'agent-markdown',
  async *discover(context) {
    const directory = join(context.packageRoot, 'agents');
    const entries = [...await context.host.list(directory)]
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.kind !== 'file' || !isAgentFile(entry.name)) continue;
      yield {
        localName: entry.name.slice(0, -'.agent.md'.length),
        source: join(directory, entry.name),
        target: 'server',
      };
    }
  },
  load(source, context) {
    return context.host.readText(source.source);
  },
};

const agentFeature = defineFeatureProvider({
  protocol: 1,
  id: agentFeatureId,
  authoring: {
    conventions: [agentFiles],
    validate: parseAgentMarkdown,
  },
  runtime: {
    project(slots, context) {
      return { value: new AgentIndex(slots, context.snapshot) };
    },
  },
});

function isAgentFile(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.agent\.md$/u.test(value);
}

export { agentFeature };
export default agentFeature;
