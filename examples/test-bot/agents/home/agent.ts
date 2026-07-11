import { defineAgent } from '@zhin.js/agent';

export default defineAgent({
  description: 'Smart home control via configured aliases only—no raw entity_id.',
  keywords: ['home', 'light', '灯', '智能家居'],
  maxIterations: 6,
  toolNames: ['home_list_aliases', 'home_get_state', 'home_turn_on', 'home_turn_off'],
});
