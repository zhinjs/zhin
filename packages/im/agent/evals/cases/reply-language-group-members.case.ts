import { defineEvalCase } from '../framework/index.js';

export default defineEvalCase({
  id: 'reply-language-group-members',
  description: 'In one group, a member who set /language gets that setting; a member who did not keeps the project fallback.',
  source: 'zhinjs/zhin#1250 b69: each member follows their own /language; unset members are unaffected',
  tags: ['context'],
  inbound: [
    { text: '帮我总结一下', scope: 'group', sender: { id: 'alice', roles: ['user'] }, locale: 'en', localeSetByUser: true },
    { text: '帮我总结一下', scope: 'group', sender: { id: 'bob', roles: ['user'] }, locale: 'zh-CN' },
  ],
  script: [{ text: 'Here is the summary.' }, { text: '这是总结。' }],
  expect: {
    outboundContains: ['Here is the summary.', '这是总结。'],
    requestInputContains: {
      1: ['Reply language (set by the user with /language): en.'],
      2: ['Reply language fallback: zh-CN.'],
    },
    stableSystemPrompt: true,
  },
});
