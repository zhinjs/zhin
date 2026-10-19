---
"@zhin.js/cli": patch
---

修复 migrate 从工作区子包运行时把显式 workspace: 依赖替换为 latest 的问题，预演与实际升级均保留原依赖来源。

恢复默认依赖安装，只有 --no-install 才跳过；pnpm 安装同步更新迁移后的锁文件；npm 锁文件与 workspace: 协议冲突时，在修改清单前给出明确提示。
