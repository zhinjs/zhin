/**
 * ICQQ 场景管理工具注册
 *
 * 平台特有工具已迁移至 agent/tools/；本模块仅注册通用群管工具。
 */
import { createSceneManagementTools, type ToolFeature } from 'zhin.js';

import type { IcqqAdapter } from "../adapter.js";
import { setIcqqAgentDeps } from "../icqq-agent-deps.js";

export function registerTools(
  toolService: ToolFeature,
  icqq: IcqqAdapter,
  pluginName: string,
): () => void {
  const disposers: (() => void)[] = [];

  setIcqqAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = icqq.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => icqq,
  });

  const sceneTools = createSceneManagementTools(icqq, "icqq");
  disposers.push(...sceneTools.map((t) => toolService.addTool(t, pluginName)));

  return () => disposers.forEach((d) => d());
}
