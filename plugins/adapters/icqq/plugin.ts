import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { permissionHostToken, createSceneRolePlatformChecker } from '@zhin.js/permission';
import { icqqRuntimeStateToken } from './src/icqq-runtime-state.js';

// Module-level guard: multiple icqq instances (icqq, icqq-2, …) share this
// module, but the prompt contributor is per-platform — register it once.
let promptContributorRegistered = false;

export default definePlugin({
  name: 'icqq',
  metadata: {
    displayName: 'ICQQ Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（icqq.endpoint list 的"运行中"数据源）
    context.resources.provide(icqqRuntimeStateToken, createEndpointRuntimeState());
    const disposePlatform = context.resources.has(permissionHostToken)
      ? context.resources.use(permissionHostToken).registerPlatform(
        'icqq',
        createSceneRolePlatformChecker(),
      )
      : undefined;
    // Agent prompt contributor (orchestrator/deferred-worker ICQQ guidance).
    // `zhin.js/agent` is an optional peer — skip silently on IM-only installs.
    if (promptContributorRegistered) return disposePlatform;
    let cancelled = false;
    let unregister: (() => void) | undefined;
    void Promise.all([
      import('zhin.js/agent'),
      import('./src/agent-prompt.js'),
    ]).then(([agent, prompt]) => {
      if (cancelled || promptContributorRegistered) return;
      agent.registerAgentPromptContributor(prompt.createIcqqAgentPromptContributor());
      promptContributorRegistered = true;
      unregister = () => agent.unregisterAgentPromptContributor('icqq');
    }).catch(() => { /* optional peer not installed */ });
    return () => {
      cancelled = true;
      unregister?.();
      disposePlatform?.();
    };
  },
});
