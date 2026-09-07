import { resolve } from 'node:path';
import { definePlugin } from 'zhin.js';
import { SelfDeliveryProject, selfDeliveryProjectToken } from '@zhin.js/agent/runtime';

export default definePlugin<{ stateDirectory: string }>({
  name: 'self-delivery-bot',
  setup(context) {
    if (context.resources.has(selfDeliveryProjectToken)) return;
    const project = new SelfDeliveryProject(resolve(context.config.get().stateDirectory));
    context.resources.provide(selfDeliveryProjectToken, project);
  },
});
