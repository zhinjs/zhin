import type { AgentBindingConfig } from './types.js';
/** Offline migration input only; never used to select an execution model. */
export interface LegacyAgentBindingConfig extends AgentBindingConfig {
  provider: string;
  model: string;
}
