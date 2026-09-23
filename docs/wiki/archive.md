---
title: Cubic Wiki 资料存档
---

# Cubic Wiki 资料存档

这里保存 [Cubic 为 zhinjs/zhin 生成的 Wiki](https://www.cubic.dev/wikis/zhinjs/zhin)：29 篇中文译文及[英文原文](/en/wiki/archive)。它们是供追溯的资料，不是当前用法指南。要解决实际问题，请先看[知识索引](/wiki/)。

英文原文抓取于 **2026-09-23**，对应源码提交 [`368db14`](https://github.com/zhinjs/zhin/commit/368db14caa4aa91311fb090f07bd792fe4b22fe7)。每篇保留源码引用和中英文切换链接；[归档清单](/wiki/cubic/source.json)记录原文来源与校验哈希。

::: warning 使用前请核对
这是一份第三方 AI 生成内容的参考快照，中文页经机器辅助翻译，尚未逐页与当前代码核验。代码示例、源码行号和运维建议可能有误或过时。实际开发请以[维护中的中文文档](/getting-started/)和当前源码为准。已确认的错误会在对应文章顶部标注；导入脚本也对少量明确错误做了修正。
:::

## 已确认勘误

| 快照主题 | 当前行为 | 维护中的文档 |
| --- | --- | --- |
| [快速开始](./cubic/quickstart) | 新项目要求 Node.js `>=22.12.0`，目前配置的 HTTP 端口为 `8068`；`8086` 是未配置时的 Runtime 回退端口。 | [入门指南](/getting-started/) |
| [插件 Runtime](./cubic/plugin-runtime)、[命令](./cubic/commands) | 命令入口为 `commands/**/index.ts`；Handler 使用 `handlers/<name>/index.ts`。 | [约定目录](/authoring/conventions) |
| [MCP](./cubic/mcp) | 可选 Runtime Host 只有在顶层配置 `mcp:` 时才注册 Tool；`ai.mcpServers` 配置的是 Agent 客户端。 | [Runtime 源码](https://github.com/zhinjs/zhin/blob/main/packages/host/mcp/src/runtime.ts)、[文档修正](https://github.com/zhinjs/zhin/pull/684) |
| [安全与沙箱](./cubic/security-sandbox) | `execApprovalMode` 为 `ask | auto | bypass`；Tool 的 `requiresApproval` 是另一组选项：`never | on-risk | once | always`。 | [Agent 配置](/ai/)、[工具开发](/authoring/agent-tools) |
| [配置管理](./cubic/config) | `zhin migrate` 不会自动把 `bots:` 改成 `endpoints:`。 | [配置文档](/configuration/) |
| [Agent 编排](./cubic/ai-orchestration)、[安全策略](./cubic/security-policy) | Tool 与 Hook 使用具名目录；`execSecurity` 与 `execApprovalMode` 是独立配置。内置默认值分别是 `deny` 与 `auto`，项目配置可以覆盖。 | [约定目录](/authoring/conventions)、[Agent 配置](/ai/) |
| [适配器核心](./cubic/adapters-core) | 快照将脚手架中的 Endpoint 示例与 `createEndpointLifecycle` 混为一谈；入站适配器示例不完整，且不能编译。 | [端点生命周期](/authoring/endpoint-lifecycle) |
| [消息段](./cubic/messaging)、[Satori](./cubic/satori) | Runtime 的 `raw` 与 `segment.raw` 不同；`wrapCardHtml` 需要背景色参数。 | [中间件与组件](/authoring/middleware-components) |
| [安全策略](./cubic/security-policy)、[生产部署](./cubic/docker-prod) | 复制 `8086` 示例前应核对实际 `http.port`；新项目使用 `8068`。`pnpm daemon` 和 `pnpm stop` 是旧项目迁移脚本。 | [生产部署](/operations/production) |

## 浏览中文译文

### 入门与架构

- [Zhin.js 简介](./cubic/intro)
- [快速开始与安装](./cubic/quickstart)
- [系统架构与分层](./cubic/arch-core)
- [插件 Runtime 与约定](./cubic/plugin-runtime)
- [入站与出站消息链路](./cubic/message-flow)
- [Generation 与热重载](./cubic/hmr-generation)

### IM、扩展与基础服务

- [命令、Handler 与中间件](./cubic/commands)
- [通用消息段与组件](./cubic/messaging)
- [数据库抽象与持久化](./cubic/database)
- [调度引擎与 Cron](./cubic/scheduling)
- [日志与遥测](./cubic/logging)

### Agent 与 AI

- [Agent 编排与 ZhinAgent](./cubic/ai-orchestration)
- [LLM Provider 与 SDK 桥接](./cubic/ai-providers)
- [Agent 工具与能力](./cubic/tools-caps)
- [Skill 与渐进披露](./cubic/skills)
- [记忆、上下文与压缩](./cubic/memory)
- [安全策略与沙箱](./cubic/security-sandbox)
- [模型上下文协议（MCP）](./cubic/mcp)

### 平台与媒体

- [适配器核心与端点生命周期](./cubic/adapters-core)
- [平台接入](./cubic/adapters-platforms)
- [Satori 富媒体](./cubic/satori)
- [语音链路（STT 与 TTS）](./cubic/speech)

### Console、配置与运维

- [远程 Console 架构](./cubic/console-arch)
- [开发 Console 页面](./cubic/console-pages)
- [配置管理](./cubic/config)
- [生产部署](./cubic/docker-prod)
- [安全策略与最佳实践](./cubic/security-policy)
- [CLI 命令与工具](./cubic/cli-tools)
- [测试与 CI 门禁](./cubic/testing)

## 更新快照

在仓库根目录运行 `python3 scripts/import-cubic-wiki.py` 可重新抓取英文原文，再运行 `python3 scripts/import-cubic-wiki.py --verify` 核对文章与清单。更新后须审阅英文差异、勘误及对应中文译文，并运行 `pnpm check:cubic-wiki-translations`；导入脚本不会覆盖中文翻译。当页面结构、预期文章 ID 或外部 HTML 变化时，脚本会停止，避免发布不完整的内容。
