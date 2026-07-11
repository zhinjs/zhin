/**
 * 钉钉适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type ISceneManagement, createSceneManagementTools, type ToolFeature } from "zhin.js";
import { DingTalkAdapter } from "./adapter.js";
import {
  dingtalkGroupPermitResolver,
  registerDingtalkPlatformPermitChecker,
} from "./platform-permit.js";
import { setDingtalkAgentDeps } from "./dingtalk-agent-deps.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/host-router").Router;
    }
  }
  interface Adapters {
    dingtalk: DingTalkAdapter;
  }
}

export * from "./types.js";
export { DingTalkEndpoint } from "./endpoint.js";
export { DingTalkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext("router", (router: any) => {
  provide({
    name: "dingtalk",
    description: "DingTalk Endpoint Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new DingTalkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: DingTalkAdapter) => {
      await adapter.stop();
    },
  });
});

useContext('tool', 'dingtalk', (toolService: ToolFeature, dingtalk: DingTalkAdapter) => {
  const disposers: (() => void)[] = [];
  disposers.push(registerDingtalkPlatformPermitChecker());
  setDingtalkAgentDeps({
    getEndpoint: (endpointId) => {
      const endpoint = dingtalk.endpoints.get(endpointId);
      if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
      return endpoint;
    },
    getAdapter: () => dingtalk,
  });
  const sceneTools = createSceneManagementTools(
    dingtalk as unknown as ISceneManagement,
    'dingtalk',
    { permitResolver: dingtalkGroupPermitResolver, registerChecker: false },
  );
  disposers.push(...sceneTools.map(t => toolService.addTool(t, plugin.name)));
  return () => disposers.forEach(d => d());
});
