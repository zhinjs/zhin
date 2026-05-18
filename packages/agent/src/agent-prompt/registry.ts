import { Logger } from '@zhin.js/core';
import type { AgentPromptContributor } from '@zhin.js/core';

const logger = new Logger(null, 'AgentPromptRegistry');

const contributors = new Map<string, AgentPromptContributor>();

export function registerAgentPromptContributor(contributor: AgentPromptContributor): void {
  const key = contributor.platform;
  if (contributors.has(key)) {
    logger.warn(`AgentPromptContributor for "${key}" already registered; replacing`);
  }
  contributors.set(key, contributor);
}

export function unregisterAgentPromptContributor(platform: string): void {
  contributors.delete(platform);
}

export function getAgentPromptContributor(platform: string | undefined): AgentPromptContributor | undefined {
  if (!platform) return undefined;
  return contributors.get(platform);
}

/** Clear all contributors (tests). */
export function clearAgentPromptContributors(): void {
  contributors.clear();
}
