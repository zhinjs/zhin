import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'sandbox',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Sandbox Adapter',
  },
});
