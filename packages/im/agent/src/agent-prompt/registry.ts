import { type AgentPromptContributor, getLogger } from '@zhin.js/core';
const logger = getLogger('AgentPromptRegistry');

const contributors = new Map<string, AgentPromptContributor>();

export function registerAgentPromptContributor(contributor: AgentPromptContributor): void {
  const key = contributor.platform;
  if (contributors.has(key)) {
    logger.warn(`Overriding AgentPromptContributor: ${key}`);
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
