import type { Plugin } from "zhin.js";
import type { ProjectFs } from "./rpc/context.js";

export type ConsoleApiOptions = {
  /** 测试注入；默认 usePlugin() */
  root?: Plugin;
  /** 项目文件读写；默认 Node fs */
  projectFs?: ProjectFs;
};
