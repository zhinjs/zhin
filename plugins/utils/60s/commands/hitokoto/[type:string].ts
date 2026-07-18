import { defineCommand } from '@zhin.js/command';
import handler from '../../src/handlers/hitokoto.js';

export default defineCommand({
  description: '随机一言',
  execute: ({ params }) => handler({ type: params.type != null ? String(params.type) : undefined }),
});
