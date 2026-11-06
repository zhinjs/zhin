import { definePlugin, definePluginCapabilityGraph } from 'zhin.js';

export default definePlugin({
  name: 'minimal-bot',
  metadata: {
    displayName: 'Minimal Bot',
  },
  capabilityGraph: definePluginCapabilityGraph({
    features: {
      adapters: ['terminal'],
      commands: ['hello', 'card'],
      tools: ['echo'],
    },
  }),
});
