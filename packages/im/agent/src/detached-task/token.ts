import { createToken } from '@zhin.js/plugin-runtime';
import type { DetachedTaskRunner } from './runner.js';

/**
 * A plugin that owns detached-task executors provides its runner under this
 * token. The IM ingress then routes `/tasks`, `/task …` and interjections to
 * it. No provider means detached tasks are off and ingress is unchanged.
 */
export const detachedTaskRunnerToken = createToken<DetachedTaskRunner>(
  'zhin.agent.detached-task-runner',
  'Detached background task runner (#731/#732)',
);
