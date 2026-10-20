---
applyTo: "basic/**,packages/**"
---

# Zhin 核心包默认开发习惯

在 basic 和 packages 目录下编辑代码时自动生效。

## 分层边界

- 以 `docs/concepts/architecture.md` 和各包 `package.json` 为准；运行 `pnpm check:architecture` 验证。
- `plugin-runtime → feature-kit → Feature packages`；`im-contract` 供 adapter/core/agent 使用；`core → zhin`，`core + ai → agent`。
- kernel 和 ai 不应引入 IM 概念，如 Adapter、Endpoint、Message。

## 目录语义

- Node 侧源码放 src/，构建产物放 lib/。
- 浏览器侧源码放 client/，构建产物放 dist/。
- 不要把仅浏览器代码混进 src/，也不要把服务端实现放进 client/。

## 导入与导出

- TypeScript 本地导入通常必须带 .js 扩展名。
- 包的 public surface 应与真实构建产物一致；不要新增指向不存在文件的 exports。
- 变更聚合导出时，优先检查 packages/im/zhin/src/index.ts 是否需要同步。

## 运行时不变量

- `usePlugin()` / `getPlugin()` 已移除；依赖必须通过 setup 的 `context.resources`、能力执行上下文的 `context.use(token)` 或当前 operation 的 Generation View 取得。
- 代级状态走 snapshot Resource；不要新增模块级 latest-value 单例或恢复 `createGenerationStore`。
- 如果改动涉及 IM 出站消息，必须保留统一链路：Message.$reply 或 Adapter.sendMessage → renderSendMessage → before.sendMessage → 平台 Endpoint。
- 不要新增绕过 before.sendMessage 的发送捷径。

## 变更落点

- Plugin、Adapter、Dispatcher、消息链：packages/im/core。
- AI 引擎、Session、Memory、Compaction、Provider：packages/im/ai。
- AI 编排、工具发现、安全策略、MCP client：packages/im/agent。
- 应用入口与聚合 re-export：packages/im/zhin。
- 底层通用能力：basic/* 和 packages/im/kernel。

## 验证习惯

- 优先运行最小范围验证：pnpm --filter <pkg> build、pnpm --filter <pkg> test。
- 跨包类型改动再运行 pnpm type-check。
- 如果改动影响架构边界、目录约定或包导出，检查 `docs/concepts/architecture.md` 和 `docs/contributing/repo-structure.md` 是否需要同步。
