#!/usr/bin/env node
/**
 * 为全局 @icqqjs/cli 的 parse-message 增加 [reply:id] 解析（与 icqq ReplyElem 对齐）。
 * 守护进程 requireString(message)，引用回复须写在 message 字符串内并由 parseMessage 解析。
 *
 * 用法：node plugins/adapters/icqq/scripts/patch-icqq-cli-reply.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

function resolveCliParseMessagePath() {
  try {
    const globalRoot = execSync("pnpm root -g", { encoding: "utf-8" }).trim();
    const candidate = path.join(
      globalRoot,
      "@icqqjs/cli/dist/lib/parse-message.js",
    );
    if (existsSync(candidate)) return candidate;
  } catch {
    /* ignore */
  }
  const fromWhich = execSync("command -v icqq", { encoding: "utf-8" }).trim();
  const cliPkg = path.resolve(
    path.dirname(fromWhich),
    "global/5/node_modules/@icqqjs/cli/dist/lib/parse-message.js",
  );
  if (existsSync(cliPkg)) return cliPkg;
  throw new Error("未找到 @icqqjs/cli/dist/lib/parse-message.js，请先 pnpm add -g @icqqjs/cli");
}

const file = resolveCliParseMessagePath();
let src = readFileSync(file, "utf-8");

if (src.includes('case "reply":')) {
  console.log(`已打过补丁，跳过: ${file}`);
  process.exit(0);
}

if (!src.includes('(face|image|at|dice|rps)')) {
  console.error("parse-message.js 格式与预期不符，请手动合并 reply 支持");
  process.exit(1);
}

src = src.replace(
  "(face|image|at|dice|rps)",
  "(face|image|at|dice|rps|reply)",
);
src = src.replace(
  `case "rps":
				parts.push({ type: "rps" });
				break;`,
  `case "rps":
				parts.push({ type: "rps" });
				break;
			case "reply":
				parts.push({
					type: "reply",
					id: value ?? ""
				});
				break;`,
);

writeFileSync(file, src);
console.log(`已补丁 reply 解析: ${file}`);
console.log("请重启 icqq 守护进程（icqq service restart 或重新 login）后生效。");
