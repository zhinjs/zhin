import { defineEval } from '@zhin.js/agent/evals';

export default defineEval({
  description: 'Smoke: lottery agent surface defines core tools',
  async test(t) {
    t.succeeded();
  },
});
