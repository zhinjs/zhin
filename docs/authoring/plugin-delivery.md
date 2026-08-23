---
title: 插件完整交付
---

# 从业务能力到可发布插件

这条路径适合已经完成第一个命令、准备交付可配置、可热更、可测试插件的作者。目标不是“代码能跑”，而是安装、运行、治理、观测和发布形成闭环。

## 1. 先写交付契约

在动手前列出输入、输出、副作用和验收方式。每项能力只选择一个创作入口：单能力放约定目录，共享资源与生命周期放 `plugin.ts`，生态级新能力才创建 Feature。

| 需求 | 入口 |
| --- | --- |
| 文本指令 | `commands/*.ts` |
| 入站编排 | `middlewares/*.ts` / `handlers/*.ts` |
| 富消息输出 | `components/*.tsx` |
| Agent 行为 | `agent/tools`、`agent/prompt-sections`、`agent/skills` |
| 数据库、定时任务、主动推送 | `plugin.ts` + Host token |

## 2. 建立包与运行拓扑

`package.json#zhin` 声明插件入口、Feature 依赖和子插件实例。`zhin.config.yml` 只提供值；它不会安装包，也不会挂载 Feature。

发布包入口必须是 JavaScript，源码型 Root Plugin 可使用 `./plugin.ts`。可选能力放 optional peer，并在 `setup` 中用 `resources.has(token)` 明确降级。

## 3. 设计配置

用 `schema.json` 声明默认值、类型与约束。Root 自身读取 `plugin:`，子插件实例读取 `plugins.<instanceKey>`；密钥使用 `${VAR}`，不要写入 Schema 默认值或示例仓库。

配置变化必须能回答三个问题：是否需要新 generation、失败时旧 generation 是否继续服务、Console 如何证明新值已发布。

## 4. 实现能力与生命周期

命令负责显式调用，中间件负责入站顺序，组件负责可移植富消息。Tool 声明模型可调用的动作，Prompt Section 只补充上下文，不能授予工具或数据权限。

连接、定时器和 Host 注册返回的清理函数进入 `lifecycle`。必须在发布前证明就绪的资源使用 `handoff`；候选代失败时，不得污染仍在服务的旧代。

## 5. 本地验收

1. 在 Sandbox 验证命令、组件和 Agent 最小路径。
2. 在 Console 运行时能力核对 owner、来源、顺序和当前 generation。
3. 修改一个能力文件，确认文件级 HMR；制造一次配置错误，确认旧代继续服务。
4. 对有副作用的 Tool 验证审批、取消和失败终态。
5. 重启 Runtime，确认数据库、会话与调度事实按契约恢复。

## 6. 测试与发布

插件至少覆盖纯函数单测、能力发现测试、一次 Runtime 集成测试和一个失败路径。平台插件还应使用 adapter harness 验证 Endpoint 生命周期与消息归一化。

```bash
pnpm typecheck
pnpm check:plugin
pnpm check:plugin-runtime-api
pnpm check:plugin-agent-publish
```

发布前检查 `files`、ESM 入口、peer dependency、生成的约定目录 JavaScript 与 changeset。安装打包产物后再跑一次 Sandbox 黄金路径，不能只测试 workspace 源码。

## 完成标准

- 新用户能从 README 完成安装、最小配置与首条消息。
- 配置错误、依赖缺失和热更失败都有明确行为。
- Console 能观察运行事实，但不泄露 Prompt 或密钥正文。
- 包内文档、公共 API、changeset 与实际 tarball 一致。

继续阅读 [`definePlugin` 全景](./define-plugin)、[约定目录](./conventions)与[Console 页面](./console-pages)。
