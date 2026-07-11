/**
 * 飞书/Lark 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import { LarkAdapter } from "./adapter.js";
import {
  larkGroupPermitResolver,
  registerLarkPlatformPermitChecker,
} from "./platform-permit.js";
import { setLarkAgentDeps } from "./lark-agent-deps.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/host-router").Router;
    }
  }
  interface Adapters {
    lark: LarkAdapter;
  }
}

export * from "./types.js";
export { LarkEndpoint } from "./endpoint.js";
export { LarkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

(useContext as (key: string, fn: (router: any) => void) => void)("router", (router) => {
  provide({
    name: "lark",
    description: "Lark/Feishu Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new LarkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LarkAdapter) => {
      await adapter.stop();
    },
  } as Context<"lark">);
});

useContext('tool', 'lark', (toolService: ToolFeature, lark: LarkAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerLarkPlatformPermitChecker());
  setLarkAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = lark.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => lark,
  });
  const sceneTools = createSceneManagementTools(
    lark as unknown as ISceneManagement,
    'lark',
    { permitResolver: larkGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));
  return () => disposers.forEach(d => d());
});
