import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'web-tools-hidden-without-network',
  description: 'A turn without network authority is never offered web_fetch, and the prompt names the real switch so the model does not invent one.',
  source: 'QQ: bot offered web_fetch, failed with "no network authority", then claimed the switch lived outside the repo',
  tags: ['tool-use'],
  inbound: { text: '帮我确认一下 Koishi 的仓库地址' },
  nativeTools: ['web_fetch', 'web_search'],
  script: [
    { toolCalls: [{ name: 'web_fetch', args: { url: 'https://github.com/koishijs/koishi' }, notOffered: true }] },
    { text: '本回合没开出网，查不了。需要主人在 zhin.config.yml 里设置 ai.agent.network.enabled: true 后重启。' },
  ],
  expect: {
    toolsNotCalled: ['web_fetch', 'web_search'],
    // Network authority varies by turn: every request receives the note in its runtime tail.
    requestInputContains: {
      1: ['ai.agent.network.enabled: true'],
      2: ['ai.agent.network.enabled: true'],
    },
    systemPromptNotContains: ['ai.agent.network.enabled: true'],
    outboundContains: ['ai.agent.network.enabled'],
    modelSteps: 2,
  },
});
