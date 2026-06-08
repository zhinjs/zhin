/**
 * Programmatic SDK entry for standalone harness (ADR 0010 D6).
 */
import type { AIConfig } from '@zhin.js/core';
import { AIService, type CreateServiceAgentOptions, type ServiceAgentResult } from './service.js';

export interface CreateAgentSessionOptions {
  config?: AIConfig;
  cwd?: string;
}

export interface AgentSessionHandle {
  service: AIService;
  prompt(text: string, options?: CreateServiceAgentOptions): Promise<ServiceAgentResult>;
  dispose(): void;
}

export function createAgentSession(options: CreateAgentSessionOptions = {}): AgentSessionHandle {
  const config = options.config ?? {};
  const service = new AIService(config);
  return {
    service,
    async prompt(text, runOptions) {
      return service.runAgent(text, runOptions);
    },
    dispose() {
      service.dispose();
    },
  };
}
