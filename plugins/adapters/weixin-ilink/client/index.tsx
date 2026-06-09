import type { PluginRegisterHostApi } from "@zhin.js/contract";
import WeixinIlinkManagement from "./WeixinIlinkManagement";

export function register(api: PluginRegisterHostApi) {
  api.addRoute({
    path: "/console/weixin-ilink",
    name: "微信 iLink",
    element: api.React.createElement(WeixinIlinkManagement, { hostReact: api.React }),
  });
  api.addTool({ id: "weixin-ilink", name: "微信 iLink", path: "/console/weixin-ilink" });
}
