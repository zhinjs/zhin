import { featureId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
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
      let previousIndex: McpIndex | undefined;
      return {
        value: index,
        dispose: () => index.stop(),
        handoff: {
          // 先停旧代连接再激活新代：独占端口型 server 热重载不会新旧并存。
          quiescePrevious(previous) {
            previousIndex = previousMcpIndex(previous);
            return previousIndex?.stop();
          },
          activateNext: () => index.start(),
          deactivateNext: () => index.stop(),
          resumePrevious() {
            return previousIndex?.start();
          },
        },
      };
    },
  },
});

function previousMcpIndex(snapshot: RuntimeSnapshot): McpIndex | undefined {
  return snapshot.projections.get(mcpFeatureId) as McpIndex | undefined;
}

export { mcpFeature };
export default mcpFeature;
