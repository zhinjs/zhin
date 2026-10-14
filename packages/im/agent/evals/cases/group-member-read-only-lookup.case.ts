import { defineEvalCase, live } from '../framework/index.js';

export default defineEvalCase({
  id: 'group-member-read-only-lookup',
  description: 'An ordinary group member can still use harmless read-only tools.',
  source: '#719 group_member turn tightening — only shell/write/outbound are removed (PR #737)',
  tags: ['tool-use'],
  inbound: { text: '@bot 北京天气怎么样', scope: 'group', sender: { id: 'bob', roles: ['user'] } },
  tools: [{ name: 'get_weather', result: 'Beijing: sunny, 22°C' }],
  script: [
    { toolCalls: [{ name: 'get_weather', args: { city: 'Beijing' } }] },
    { text: '北京晴，22°C。' },
  ],
  expect: { toolsCalled: ['get_weather'], outboundContains: ['22°C'], modelSteps: 2 },
  live: { checks: (run) => [live.executedWithArg(run, 'get_weather', 'city', /北京|beijing/i), live.replyMatches(run, /22/, 'reply states the looked-up temperature'), live.turnsCompleted(run)] },
});
