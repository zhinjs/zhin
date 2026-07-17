import { featureId } from '@zhin.js/next-kernel';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/next-feature-kit';
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
