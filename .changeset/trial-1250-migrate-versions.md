---
"@zhin.js/cli": patch
---

`zhin migrate` 核对实际安装的版本（#1250）：pnpm 11 默认不安装发布不满一天的版本（`minimumReleaseAge`），刚发布的 Zhin 版本会停在旧版本。migrate 现在把升级目标以 `name@version` 写进 `pnpm-workspace.yaml#minimumReleaseAgeExclude`（与 pnpm 写入新脚手架的形式一致，已覆盖的条目不重复；没有该文件的项目不创建），把 pnpm 11 留下的 `allowBuilds` 占位值改为 `true`，安装后读取 `node_modules` 列出每个包升级前后的实际版本，没装上声明版本时以失败退出并说明原因（发布冷却期、`overrides` 冲突）。`zhin doctor` 新增「Zhin 已安装版本」检查：已安装版本不满足 `package.json` 声明时警告并给出修复命令。migrate 不再创建 `src/plugins`，未使用 AI 的项目不再生成 `SOUL.md` / `TOOLS.md` / `AGENTS.md`，输出统一为中文。
