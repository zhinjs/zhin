import { defineCommand } from 'zhin.js/command';
import { selfDeliveryProjectToken } from '../../../src/pipeline.js';

export default defineCommand({
  description: 'Check self-delivery configuration and live capabilities',
  async execute(context) { return JSON.stringify(await context.use(selfDeliveryProjectToken).doctor()); },
});
