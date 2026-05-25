import { bootstrapVercel } from "zhin.js/vercel";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEdgeConsoleEntriesRecord,
  registerEdgeConsoleAssetRoutes,
} from "../src/edge-console-assets.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const { fetch } = await bootstrapVercel({
  projectRoot,
  getConsoleEntriesRecord: getEdgeConsoleEntriesRecord,
  registerAssetRoutes: registerEdgeConsoleAssetRoutes,
});

export default fetch;
export const config = { runtime: "edge" };
