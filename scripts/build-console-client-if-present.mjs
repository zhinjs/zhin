/**
 * 兼容旧路径：在插件包根目录执行，等价于 `zhin build`（仅 client/src 智能构建）。
 * 依赖已编译的 @zhin.js/cli（basic/cli/lib/cli.js）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = path.join(repoRoot, "basic/cli/lib/cli.js");
if (!fs.existsSync(cliJs)) {
  console.error(
    "未找到 basic/cli/lib/cli.js，请先执行: pnpm --filter @zhin.js/cli build",
  );
  process.exit(1);
}
const r = spawnSync(process.execPath, [cliJs, "build"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
process.exit(r.status ?? 1);
