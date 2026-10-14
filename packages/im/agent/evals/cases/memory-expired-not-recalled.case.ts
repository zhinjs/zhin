import { defineEvalCase } from '../framework/index.js';

/** #734: expired task state and other users' memory never reach the model; live facts do. */
export default defineEvalCase({
  id: 'memory-expired-not-recalled',
  description: 'Recall injects a live fact but not expired task state or another user\'s memory.',
  source: '#734 memory retrieval — expired entries are not recalled',
  tags: ['memory'],
  inbound: { text: '我的部署任务进度怎么样了？', sender: { id: 'alice', roles: ['user'] } },
  memory: [
    { scope: 'user', scope_key: 'alice', key: 'deploy:target', content: '部署目标是 Fly.io 新加坡区域' },
    {
      scope: 'session', scope_key: 'im:eval:eval-bot:private:alice', key: 'deploy:progress',
      content: '部署任务进度：第 2 步共 5 步', kind: 'task_state', expires_at: 1,
    },
    { scope: 'user', scope_key: 'bob', key: 'deploy:secret', content: '部署任务密钥在 bob 的笔记里' },
  ],
  script: [{ text: '目前没有进行中的部署任务记录，部署目标是 Fly.io 新加坡区域。' }],
  expect: {
    modelInputContains: ['deploy:target: 部署目标是 Fly.io 新加坡区域'],
    modelInputNotContains: ['第 2 步共 5 步', 'bob 的笔记'],
    modelSteps: 1,
  },
});
