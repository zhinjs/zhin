/**
 * Build A2A AgentCard per ai.agents binding.
 */
import { A2A_PROTOCOL_VERSION, type AgentCard, type AgentSkill } from '@a2a-js/sdk';

import type { AgentBindingRegistry } from '@zhin.js/agent/config';
import { a2aAgentCardUrl, a2aJsonRpcUrl, a2aRestUrl } from './config.js';

function makeSkill(partial: Pick<AgentSkill, 'id' | 'name' | 'description'> & { tags?: string[] }): AgentSkill {
  return {
    ...partial,
    tags: partial.tags ?? [],
    examples: [],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
  };
}

const DEFAULT_SKILLS: AgentSkill[] = [
  makeSkill({
    id: 'delegate',
    name: 'Delegate Task',
    description: 'Accept structured task delegation via A2A Send Message',
    tags: ['orchestration', 'delegate'],
  }),
];

export function buildAgentCardForBinding(
  agentName: string,
  registry: AgentBindingRegistry,
  publicBaseUrl: string,
): AgentCard | null {
  const binding = registry.getBinding(agentName);
  if (!binding) return null;

  const nickname = binding.nickname ?? agentName;
  const jsonRpcUrl = a2aJsonRpcUrl(publicBaseUrl, agentName);
  const restUrl = a2aRestUrl(publicBaseUrl, agentName);

  const skills: AgentSkill[] = [
    makeSkill({
      id: agentName,
      name: nickname,
      description: `Zhin agent "${agentName}" (${binding.providerAlias}/${binding.model})`,
      tags: ['zhin', agentName],
    }),
    ...DEFAULT_SKILLS,
  ];

  return {
    name: nickname,
    description: `Zhin.js A2A agent "${agentName}" — provider ${binding.providerAlias}, model ${binding.model}`,
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: jsonRpcUrl,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
      {
        url: restUrl,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: {
      organization: 'Zhin.js',
      url: 'https://github.com/zhinjs/zhin',
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
    },
    securitySchemes: {
      bearer: {
        scheme: {
          $case: 'httpAuthSecurityScheme',
          value: {
            description: 'Bearer token (http.token)',
            scheme: 'Bearer',
            bearerFormat: '',
          },
        },
      },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    skills,
    signatures: [],
    documentationUrl: a2aAgentCardUrl(publicBaseUrl, agentName),
  };
}

export function listExposableAgentNames(registry: AgentBindingRegistry): string[] {
  return registry.listAgentNames();
}
