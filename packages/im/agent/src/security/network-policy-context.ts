import { AsyncLocalStorage } from 'node:async_hooks';

export interface ToolNetworkPolicy {
  httpsOnly?: boolean;
  allowedDomains?: readonly string[];
}

const storage = new AsyncLocalStorage<ToolNetworkPolicy>();

export function runWithToolNetworkPolicy<T>(policy: ToolNetworkPolicy, fn: () => T): T {
  return storage.run(policy, fn);
}

export function getToolNetworkPolicy(): ToolNetworkPolicy | undefined {
  return storage.getStore();
}
