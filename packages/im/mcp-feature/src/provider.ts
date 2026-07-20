import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { parseMcpDefinition } from './definition.js';
import { McpIndex } from './mcp-index.js';

export const mcpFeatureId = featureId('zhin.mcp');

const mcpFeature = defineFeatureProvider({
  protocol: 1,
  id: mcpFeatureId,
  authoring: {
    conventions: [typeScriptModules({
      id: 'mcp-ts',
      directory: 'mcp',
      recursive: false,
    })],
    validate: parseMcpDefinition,
  },
  runtime: {
    async project(slots, context) {
      const index = await McpIndex.create(slots, context.snapshot);
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          activateNext: () => index.start(),
          deactivateNext: () => index.stop(),
        },
      };
    },
  },
});

export { mcpFeature };
export default mcpFeature;
