import { featureId } from '@zhin.js/plugin-runtime';
import { capture, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
import { parseAgentToolDefinition } from './definition.js';
import { ToolIndex } from './tool-index.js';

export const toolFeatureId = featureId('zhin.agent-tool');

const toolFeature = defineFeatureProvider({
  protocol: 1,
  id: toolFeatureId,
  authoring: {
    setupMethod: 'addTool',
    conventions: [directoryModules({
      id: 'tool-directories',
      layouts: [
        {
          segments: ['tools', capture('tool', 'identifier')],
          localName: ({ tool }) => tool!,
        },
        {
          segments: ['agents', capture('agent'), 'tools', capture('tool', 'identifier')],
          localName: ({ agent, tool }) => `agent/${agent}/${tool}`,
        },
        {
          segments: ['skills', capture('skill'), 'tools', capture('tool', 'identifier')],
          localName: ({ skill, tool }) => `skill/${skill}/${tool}`,
        },
        {
          segments: [
            'agents', capture('agent'), 'skills', capture('skill'),
            'tools', capture('tool', 'identifier'),
          ],
          localName: ({ agent, skill, tool }) => `agent/${agent}/skill/${skill}/${tool}`,
        },
      ],
    })],
    validate: parseAgentToolDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new ToolIndex(slots, context.snapshot) };
    },
  },
});

export { toolFeature };
export default toolFeature;
