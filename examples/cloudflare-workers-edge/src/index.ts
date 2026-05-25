import { bootstrapCloudflare } from "zhin.js/cloudflare";
import {
  getEdgeConsoleEntriesRecord,
  registerEdgeConsoleAssetRoutes,
} from "./edge-console-assets.js";
import { resolveEdgeProjectRoot } from "./resolve-project-root.js";

type WorkerEnv = {
  ZHIN_PROJECT_ROOT?: string;
  HTTP_TOKEN?: string;
  [key: string]: string | undefined;
};

let fetchHandler: (req: Request) => Promise<Response>;
let ready: Promise<void> | undefined;

function resolveProjectRoot(env?: WorkerEnv): string {
  const fromBinding = env?.ZHIN_PROJECT_ROOT?.trim();
  if (fromBinding) return fromBinding;
  return resolveEdgeProjectRoot();
}

function ensureReady(env?: WorkerEnv): Promise<void> {
  if (ready) return ready;
  ready = bootstrapCloudflare({
    projectRoot: resolveProjectRoot(env),
    getConsoleEntriesRecord: getEdgeConsoleEntriesRecord,
    registerAssetRoutes: registerEdgeConsoleAssetRoutes,
    afterPluginsLoaded: async () => {
      await import("./plugins/demo.js");
    },
  }).then((rt) => {
    fetchHandler = rt.fetch;
  });
  return ready;
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    return ensureReady(env).then(() => fetchHandler(request));
  },
};
