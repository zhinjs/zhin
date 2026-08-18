import { featureId } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider, typeScriptModules } from '@zhin.js/feature-kit';
import { parseMcpDefinition } from './definition.js';
import { McpIndex } from './mcp-index.js';

export const mcpFeatureId = featureId('zhin.mcp');

const mcpFeature = defineFeatureProvider({
  protocol: 1,
  id: mcpFeatureId,
  authoring: {
    setupMethod: 'addMcp',
    conventions: [typeScriptModules({
      id: 'mcp-ts',
      directory: 'mcp',
      recursive: false,
    })],
    validate: parseMcpDefinition,
  },
  runtime: {
    async project(slots, context) {
      const index = await McpIndex.create(slots, context.snapshot, context.signal);
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          // Candidate connections become ready before publication. The old
          // index stays usable until its snapshot's final lease drains.
          activateNext: (signal) => index.start(signal),
          deactivateNext: () => index.stop(),
        },
      };
    },
  },
});

export { mcpFeature };
export default mcpFeature;
