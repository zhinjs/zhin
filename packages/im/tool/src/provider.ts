import { featureId } from '@zhin.js/plugin-runtime';
import { capture, captured, defineFeatureProvider, directoryModules } from '@zhin.js/feature-kit';
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
          localName: (values) => captured(values, 'tool'),
        },
        {
          segments: ['agents', capture('agent'), 'tools', capture('tool', 'identifier')],
          localName: (values) => `agent/${captured(values, 'agent')}/${captured(values, 'tool')}`,
        },
        {
          segments: ['skills', capture('skill'), 'tools', capture('tool', 'identifier')],
          localName: (values) => `skill/${captured(values, 'skill')}/${captured(values, 'tool')}`,
        },
        {
          segments: [
            'agents', capture('agent'), 'skills', capture('skill'),
            'tools', capture('tool', 'identifier'),
          ],
          localName: (values) => `agent/${captured(values, 'agent')}/skill/${captured(values, 'skill')}/${captured(values, 'tool')}`,
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
