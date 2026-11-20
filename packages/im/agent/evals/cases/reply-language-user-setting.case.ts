import { defineEvalCase } from '../framework/index.js';

const USER_SET = 'Reply language (set by the user with /language): en.';

export default defineEvalCase({
  id: 'reply-language-user-setting',
  description: 'A language the user set with /language reaches the model as their own setting, ahead of the language they write in.',
  source: 'zhinjs/zhin#1250 b69: /language en changed command text but AI replies stayed in the language of the question',
  tags: ['context'],
  inbound: { text: '今天适合出门散步吗？', locale: 'en', localeSetByUser: true },
  script: [{ text: 'Yes, it is a nice day for a walk.' }],
  expect: {
    outboundContains: ['nice day for a walk'],
    modelInputContains: [USER_SET, 'only an explicit language request in the current message overrides it'],
    modelInputNotContains: ['Reply language fallback:'],
    systemPromptContains: ["else the user's /language setting"],
    systemPromptNotContains: [USER_SET],
  },
});
