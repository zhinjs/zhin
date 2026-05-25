import { bootstrapDeno } from "zhin.js/deno";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  getEdgeConsoleEntriesRecord,
  registerEdgeConsoleAssetRoutes,
} from "./src/edge-console-assets.ts";
const projectRoot = path.resolve(
  import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)),
);

const rt = await bootstrapDeno({
  projectRoot,
  getConsoleEntriesRecord: getEdgeConsoleEntriesRecord,
  registerAssetRoutes: registerEdgeConsoleAssetRoutes,
});

const { http } = rt;

Deno.serve({ port: http.port, hostname: http.host }, rt.fetch);
