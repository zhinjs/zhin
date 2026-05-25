/**
 * Edge pre-deploy：构建 Console 静态资源 + src/console-assets.manifest.json。
 * 运行时依赖由 package.json 的 npm:@latest 在部署时解析。
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const playground = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const toolsDir = path.join(playground, ".deploy-tools");
mkdirSync(toolsDir, { recursive: true });
const toolsPkg = path.join(toolsDir, "package.json");
if (!existsSync(toolsPkg)) {
  writeFileSync(
    toolsPkg,
    JSON.stringify({ name: "zhin-deploy-tools", private: true, type: "module" }, null, 2),
  );
}
if (!existsSync(path.join(toolsDir, "node_modules/esbuild"))) {
  execSync("npm install --no-fund --no-audit esbuild@0.25.5", {
    stdio: "inherit",
    cwd: toolsDir,
  });
}

process.env.DEPLOY_TOOLS_DIR = toolsDir;

execSync(`node ${path.join(playground, "scripts/build-console-assets.mjs")}`, {
  stdio: "inherit",
  cwd: playground,
  env: process.env,
});

console.log("[prepare-deploy] ok (static/console)");
