---
"@zhin.js/gateway": patch
"@zhin.js/console-protocol": patch
"@zhin.js/cli": patch
"@zhin.js/client": patch
---

依赖事务回滚后不再让机器人停在 `stopped`（#1250）：

- 回滚时即使恢复文件或重新安装依赖失败，只要实例原来在运行就仍尝试拉起；拉起失败单独记入新字段 `restartError`（`GatewayPackageTransactionResult`），`rollbackError` 只描述恢复文件 / 重新安装依赖。
- pnpm 11 在依赖已安装完成、只是跳过了未放行的构建脚本时以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。网关（以及没有网关时的 `zhin install`）在确认依赖已就位（`node_modules/.modules.yaml` 存在且 `add` 的包都在）后不再把它当成安装失败，而是在结果里给出 `ignoredBuilds` 并提示用 `allowBuilds` 放行后 `pnpm rebuild`。
- CLI 打印事务时，包管理器的原文逐行加 `│` 前缀放在对应步骤下，与「· 步骤」行分开；回滚失败时分别说明回滚错误与实例是否已重新启动。
