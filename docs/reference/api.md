---
title: API Reference
---

# 从源码生成的 API Reference

API Reference 直接读取 Zhin 的公开创作入口、Host 契约和 JSDoc。签名、泛型、源码位置与弃用标记随每次文档站构建重新生成，不维护第二份手写声明。

<a class="api-reference-link" href="/api/index.html" target="_blank" rel="noopener">打开完整 API Reference →</a>

## 该查哪一层

| 目标 | 优先入口 |
| --- | --- |
| 定义插件 | `zhin.js` |
| 编写命令 | `zhin.js/command` |
| 编写 Adapter | `zhin.js/adapter` |
| 编写组件 | `zhin.js/component` |
| 编写中间件 | `zhin.js/middleware` |
| 编写 Handler | `zhin.js/handler` |
| 编写 Agent Tool | `@zhin.js/tool`；`agent/tools/` 也可从 `zhin.js/agent` 导入 |
| 解析 Skill Markdown | `@zhin.js/skill` |
| 注入 Prompt Section | `@zhin.js/prompt-section`（experimental） |
| 使用数据库、调度与跨平台发送 Host | `zhin.js` 的 `databaseHostToken`、`scheduleHostToken`、`outboundHostToken` |
| 注册 HTTP / WebSocket 路由 | `@zhin.js/host-http` 的 `httpHostToken` |
| 接入 IM 消息网关 | `zhin.js/core/runtime` 的 `outboundMessageToken` |
| 注册 Agent 能力资源 | `zhin.js/agent` 的 `AgentResourceHub`（experimental） |

API Reference 回答“签名是什么”；指南回答“为何这样组合”。从[插件创作](/authoring/define-plugin)学习交付路径，从 [Public API 面](/contributing/public-api-surface)确认稳定性承诺。

## 维护规则

运行 `pnpm docs:api` 生成站点，运行 `pnpm check:api-docs` 只做类型与注释校验。未知 JSDoc 标签、失效符号链接或 TypeScript 错误都会让门禁失败。

生成器只接收 Public API SSOT 中承诺的创作入口与 Host 契约，不把 `*Index`、Repository、Root Runtime、解析器或装配 helper 等导出但不承诺兼容的内部机制发布为用户 API。反射 allowlist 会在公开面漂移时让 CI 失败。

生成目录位于 `docs/public/api`，不提交构建产物。GitHub Pages 工作流执行 `pnpm docs:build` 时会先生成 API，再由 VitePress 一并发布。

<style>
.api-reference-link {
  display: inline-flex;
  margin: 8px 0 20px;
  padding: 10px 16px;
  border-radius: 8px;
  color: white !important;
  font-weight: 700;
  text-decoration: none !important;
  background: var(--vp-c-brand-1);
}
.api-reference-link:hover { background: var(--vp-c-brand-2); }
</style>
