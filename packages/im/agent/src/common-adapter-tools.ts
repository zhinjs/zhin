/**
 * Agent-side scene management tool creation.
 *
 * Delegates interface, specs, constants, and buildSceneMethodArgs to @zhin.js/core,
 * then adapts the result to the agent Tool type.
 */

import { createSceneManagementToolsRaw, buildSceneMethodArgs, SCENE_MANAGEMENT_METHOD_SPECS, SCENE_MANAGEMENT_SKILL_KEYWORDS, SCENE_MANAGEMENT_SKILL_TAGS, type ISceneManagement, type SceneManagementMethodSpec } from '@zhin.js/core';
import type { Tool, ToolScope } from './orchestrator/types.js';
export type { ISceneManagement, SceneManagementMethodSpec };
export { SCENE_MANAGEMENT_METHOD_SPECS, SCENE_MANAGEMENT_SKILL_KEYWORDS, SCENE_MANAGEMENT_SKILL_TAGS, buildSceneMethodArgs };

export function createSceneManagementTools(
  adapter: ISceneManagement,
  prefix: string,
): Tool[] {
  return createSceneManagementToolsRaw<Tool>(adapter, prefix, (spec, prefix, execute) => ({
    name: `${prefix}_${spec.toolSuffix}`,
    description: `${spec.description} (${prefix})`,
    parameters: {
      type: 'object' as const,
      properties: {
        endpoint_id: { type: 'string', description: 'Endpoint ID', contextKey: 'endpointId' },
        scene_id: { type: 'string', description: 'IM 场景 ID', contextKey: 'sceneId' },
        ...Object.fromEntries(Object.entries(spec.extraParams)),
      },
      required: ['endpoint_id', 'scene_id', ...(spec.extraRequired ?? [])],
    },
    execute,
    tags: ['scene', 'management', prefix],
    keywords: spec.keywords,
    ...(spec.permit ? { permissions: [spec.permit] } : {}),
    scopes: ['group', 'channel'] as ToolScope[],
    preExecutable: spec.preExecutable,
  }));
}
