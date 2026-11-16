import { definePlugin } from 'zhin.js';
import { displayName } from './src/index.js';

/**
 * Adapter plugin entry. The adapter itself is discovered from adapters/ipad-wechat;
 * endpoint configuration comes from the bot config `ipad-wechat:` (see schema.json).
 */
export default definePlugin({
  name: 'ipad-wechat',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: { displayName },
});
