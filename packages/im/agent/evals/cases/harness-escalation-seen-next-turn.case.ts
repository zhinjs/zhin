import { defineEvalCase } from '../framework/index.js';

// #1250 batch 26 review: the `escalate` tool asks the human and says "直接回复这条消息告诉我你的决定即可".
// That only works when the next turn knows what was asked, so the question is recorded for the session.
export default defineEvalCase({
  id: 'harness-escalation-seen-next-turn',
  description: 'The question an escalation asked reaches the next turn of the session, where the answer arrives.',
  source: '#1250 batch 26 review (escalate entry point)',
  tags: ['collaboration', 'context'],
  inbound: [
    { text: '帮我把城市人口做成表格', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
    { text: '用北京的', sender: { id: 'master', chatRole: 'owner', chatRoleLevels: { owner: 'global' } } },
  ],
  agents: [{ name: 'draw', description: 'Draws tables; unused in this case.', tools: [] }],
  script: [
    { toolCalls: [{ name: 'escalate', args: { reason: '要用哪个城市的人口数据？' } }] },
    { text: '我先问一下要用哪个城市的数据。' },
    { text: '好的，用北京的数据。' },
  ],
  expect: {
    outboundContains: ['需要你来决定：要用哪个城市的人口数据？', '直接回复这条消息'],
    requestInputContains: { 3: ['已请用户决定：要用哪个城市的人口数据？'] },
    modelSteps: 3,
  },
});
