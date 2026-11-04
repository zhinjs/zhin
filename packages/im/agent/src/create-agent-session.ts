/**
 * Programmatic SDK entry for standalone harness (ADR 0010 D6).
 */
import { AIService, type CreateServiceAgentOptions, type ServiceAgentResult, type AIServiceConfig } from './service.js';

export interface CreateAgentSessionOptions {
  config?: AIServiceConfig;
  cwd?: string;
}

export interface AgentSessionHandle {
  service: AIService;
  prompt(text: string, options: CreateServiceAgentOptions): Promise<ServiceAgentResult>;
  dispose(): Promise<void>;
}

export function createAgentSession(options: CreateAgentSessionOptions = {}): AgentSessionHandle {
  const config = options.config ?? {};
  const service = new AIService(config);
  return {
    service,
    async prompt(text, runOptions) {
      return service.runAgent(text, runOptions);
    },
    async dispose() {
      await service.dispose();
    },
  };
}
