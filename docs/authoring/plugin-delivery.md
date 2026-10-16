---
title: "插件完整交付"
description: "把一个能跑的插件变成可配置、可热重载、有测试、可发布到 npm 的插件：设计、实现、本地验收、测试与发布清单"
---

# 插件完整交付

这一页适合已经写好第一个命令、准备把插件**交给别人使用**的作者。目标不只是"代码能跑"，而是别人能安装、能配置、出错时行为可预期、能在 Console 里观察到，并且能发布到 npm。

按下面六步走，每一步结尾都有可以自查的问题。

## 1. 先写清楚插件要做什么

动手前列出：用户输入什么、插件输出什么、有哪些副作用（写数据库、发消息、调外部 API），以及怎么验收。然后为每项能力选择**一种**写法：

| 需求 | 放在哪里 |
| --- | --- |
| 用户输入的命令 | `commands/*/index.ts` |
| 处理每条消息或平台事件 | `middlewares/*/index.ts` / `handlers/*/index.ts` |
| 卡片、图文等富消息 | `components/*/index.tsx` |
| AI 可调用的动作和背景知识 | `tools/`、`prompt-sections/`、`skills/` |
| 数据库、定时任务、主动推送 | `plugin.ts` 的 `setup`，通过框架资源（Host token）取用 |

单个能力放约定目录；需要共享资源或生命周期的放 `plugin.ts`；只有要给整个生态定义一种新能力时才需要写 Feature。

## 2. 声明包结构

- `package.json#zhin` 声明插件入口、用到的 Feature 和子插件。
- `zhin.config.yml` 只提供配置**值**，它不会安装包，也不会启用 Feature。
- 发布到 npm 的插件入口必须是 JavaScript（`./plugin.js`）；本地项目可以直接用 `./plugin.ts`。见 [definePlugin · 开发入口与 npm 发布入口](./define-plugin.md#开发入口与-npm-发布入口)。
- 可选的能力（数据库、HTML 渲染等）声明为 optional peer，并在 `setup` 里先用 `context.resources.has(token)` 判断，缺失时明确降级。

## 3. 设计配置

用 `definePlugin({ config: Schema.object(...) })` 一次性声明默认值、类型、约束和 Console 表单信息，`Schema.Output` 会推导出配置类型；也可以用根目录的 `schema.json`，但两者只能选一个（`isolated` 插件只能用 `schema.json`）。见 [definePlugin · 读取配置](./define-plugin.md#读取配置)。

- 你的 Bot 自身读 `plugin:` 段，子插件读 `plugins.<instanceKey>` 段。
- 密钥用 `${VAR}` 引用环境变量，不要写进 Schema 默认值或示例仓库。

自查：修改某个配置后，是否需要重载插件？新配置非法时，旧配置是否继续生效？怎样在 Console 里确认新值已经生效？

## 4. 实现能力并管理生命周期

- 命令响应用户的明确调用；中间件按顺序处理入站消息；组件负责在不同平台都能显示的富消息。
- Tool 声明 AI 可以执行的动作；Prompt Section 只补充上下文，**不能**授予工具或数据权限。
- 打开的连接、定时器，以及框架资源注册返回的清理函数，都交给 `lifecycle`（`context.lifecycle.add(...)`），热重载时自动释放。
- 必须连接成功后才能允许切换到新版本的资源，用 `handoff` 登记。新版本准备失败时，不能影响仍在服务的旧版本。

详见 [definePlugin · 在热重载时释放资源](./define-plugin.md#在热重载时释放资源)。

## 5. 本地验收

1. 在 Sandbox 里把命令、组件和 AI 的最简单用法各走一遍。
2. 在 Console 的"运行时能力"里核对每项能力的所属插件、来源、顺序和当前版本。
3. 修改一个能力文件，确认只有它被重载；故意写错一次配置，确认旧版本继续服务。
4. 对有副作用的 Tool，验证审批、取消和失败时的结果。
5. 重启 Bot，确认数据库、会话和定时任务按预期恢复。

## 6. 测试与发布

插件至少需要：纯函数的单元测试、一个"能力能被发现"的测试、一次完整运行的集成测试，以及一个失败路径的测试。平台适配器还应使用 adapter harness 验证连接生命周期和消息转换。不想手工拼上下文、写 `as never` 时，用 [插件测试](./testing.md) 里的假运行环境。

```bash
pnpm build
pnpm check:plugin
pnpm check:plugin-runtime-api
pnpm check:plugin-capability-publish
```

发布前检查 `files`、ESM 入口、peer dependency、约定目录生成的 JavaScript 以及 changeset。**用打包后的产物**安装到一个新项目里，再跑一次 Sandbox 的完整流程——不要只测试 workspace 里的源码。

## 发布前的完成标准

- 新用户照着 README 能完成安装、最小配置并收到第一条回复。
- 配置错误、依赖缺失和热重载失败都有明确的行为和提示。
- Console 能观察到运行状态，但不会泄露 Prompt 正文或密钥。
- 包内文档、公开 API、changeset 与实际发布的 tarball 一致。

## 下一步

- [definePlugin](./define-plugin.md)：入口能做的所有事。
- [约定目录](./conventions.md)：每种能力放在哪里。
- [Console 页面](./console-pages.md)：给插件加一个管理页面。
- [本地联调指南](./local-dev.md)：发布前在外部项目里联调本地插件与框架。
