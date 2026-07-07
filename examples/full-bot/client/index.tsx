import { registerOrchestrationConsole } from '@zhin.js/client';

export function register(api: Parameters<typeof registerOrchestrationConsole>[0]) {
  registerOrchestrationConsole(api);
}
