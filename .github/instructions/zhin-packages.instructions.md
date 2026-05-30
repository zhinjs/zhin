---
applyTo: "basic/**,packages/**"
---

# Zhin 核心包默认开发习惯

在 basic 和 packages 目录下编辑代码时自动生效。

## 分层边界

- 依赖方向保持单向：basic → kernel → ai → core → agent → zhin。
- kernel 和 ai 不应引入 IM 概念，如 Adapter、Bot、Message。
- packages/queue-runtime 是平行运行时，不要把 IM 主发送链规则混进它。

## 目录语义

- Node 侧源码放 src/，构建产物放 lib/。
- 浏览器侧源码放 client/，构建产物放 dist/。
- 不要把仅浏览器代码混进 src/，也不要把服务端实现放进 client/。

## 导入与导出

- TypeScript 本地导入通常必须带 .js 扩展名。
- 包的 public surface 应与真实构建产物一致；不要新增指向不存在文件的 exports。
- 变更聚合导出时，优先检查 packages/zhin/src/index.ts 是否需要同步。

## 运行时不变量

- 如果改动涉及 Plugin 上下文，usePlugin() 只能在模块顶层调用。
- 如果改动涉及 IM 出站消息，必须保留统一链路：Message.$reply 或 Adapter.sendMessage → renderSendMessage → before.sendMessage → 平台 Bot。
- 不要新增绕过 before.sendMessage 的发送捷径。

## 变更落点

- Plugin、Adapter、Dispatcher、消息链：packages/core。
- AI 引擎、Session、Memory、Compaction、Provider：packages/ai。
- AI 编排、工具发现、安全策略、MCP client：packages/agent。
- 应用入口与聚合 re-export：packages/zhin。
- 底层通用能力：basic/* 和 packages/kernel。

## 验证习惯

- 优先运行最小范围验证：pnpm --filter <pkg> build、pnpm --filter <pkg> test。
- 跨包类型改动再运行 pnpm type-check。
- 如果改动影响架构边界、目录约定或包导出，检查 docs/architecture-overview.md 和 docs/contributing/repo-structure.md 是否需要同步。