import { resolve } from 'node:path';
import { definePlugin } from 'zhin.js';
import { SelfDeliveryProject, selfDeliveryProjectStore } from './src/pipeline.js';

export default definePlugin<{ stateDirectory: string }>({
  name: 'self-delivery-bot',
  setup(context) {
    if (selfDeliveryProjectStore.has(context)) return;
    const project = new SelfDeliveryProject(resolve(context.config.get().stateDirectory));
    selfDeliveryProjectStore.provide(context, project);
  },
});
