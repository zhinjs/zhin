import { AsyncLocalStorage } from 'node:async_hooks';

export interface ToolNetworkPolicy {
  httpsOnly?: boolean;
  allowedDomains?: readonly string[];
}

const storage = new AsyncLocalStorage<ToolNetworkPolicy>();
