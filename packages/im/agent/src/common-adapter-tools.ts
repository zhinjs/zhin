/**
 * Agent-side group management tool creation.
 *
 * Delegates interface, specs, constants, and buildMethodArgs to @zhin.js/core,
 * then adapts the result to the agent Tool type.
 */

import {
  createGroupManagementToolsRaw,
  buildMethodArgs,
  GROUP_METHOD_SPECS,
  GROUP_MANAGEMENT_SKILL_KEYWORDS,
  GROUP_MANAGEMENT_SKILL_TAGS,
} from '@zhin.js/core';
import type { IGroupManagement, GroupMethodSpec } from '@zhin.js/core';
import type { Tool, ToolScope } from './orchestrator/types.js';

export type { IGroupManagement, GroupMethodSpec };
export { GROUP_METHOD_SPECS, GROUP_MANAGEMENT_SKILL_KEYWORDS, GROUP_MANAGEMENT_SKILL_TAGS, buildMethodArgs };

export function createGroupManagementTools(
  adapter: IGroupManagement,
  prefix: string,
): Tool[] {
  return createGroupManagementToolsRaw<Tool>(adapter, prefix, (spec, prefix, execute) => ({
    name: `${prefix}_${spec.toolSuffix}`,
    description: `${spec.description} (${prefix})`,
    parameters: {
      type: 'object' as const,
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint ID', contextKey: 'endpointId' },
        scene_id: { type: 'string', description: '群/服务器 ID', contextKey: 'sceneId' },
        ...Object.fromEntries(Object.entries(spec.extraParams)),
      },
      required: ['endpoint_id', 'scene_id', ...(spec.extraRequired ?? [])],
    },
    execute,
    tags: ['group', 'management', prefix],
    keywords: spec.keywords,
    ...(spec.permit ? { permissions: [spec.permit] } : {}),
    scopes: ['group'] as ToolScope[],
    preExecutable: spec.preExecutable,
  }));
}