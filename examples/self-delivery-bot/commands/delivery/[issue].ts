import { defineCommand } from 'zhin.js/command';
import { selfDeliveryProjectToken } from '@zhin.js/agent/runtime';

export default defineCommand({
  description: 'Select a GitHub Issue with explicit acceptance criteria',
  params: { issue: { type: 'number' } },
  async execute(context) {
    if (typeof context.params.issue !== 'number') throw new Error('Issue number is required');
    return JSON.stringify(await context.use(selfDeliveryProjectToken).select({
      identity: context.input, issueNumber: context.params.issue,
      acceptanceCriteria: [context.args.join(' ')],
    }));
  },
});
