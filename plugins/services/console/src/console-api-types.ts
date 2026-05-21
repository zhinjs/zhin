import type { Plugin } from "zhin.js";
import type { ConsoleParity } from "./rpc/parity.js";
import type { ProjectFs } from "./rpc/context.js";

export type ConsoleApiOptions = {
  parity?: ConsoleParity;
  /** Edge / 测试注入；默认 usePlugin() */
  root?: Plugin;
  /** 项目文件读写；Host 默认 Node fs，Edge 传 createDenoProjectFs */
  projectFs?: ProjectFs;
};
