import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { parseAgentToolDefinition } from './definition.js';
import { ToolIndex } from './tool-index.js';

export const toolFeatureId = featureId('zhin.agent-tool');

const toolFeature = defineFeatureProvider({
  protocol: 1,
  id: toolFeatureId,
  authoring: {
    conventions: [typeScriptModules({
      id: 'tools-ts',
      directory: 'tools',
      recursive: false,
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
