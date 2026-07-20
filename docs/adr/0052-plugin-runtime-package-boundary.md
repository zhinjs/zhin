# ADR 0052: Plugin Runtime 独立于旧 Kernel

- 状态：Accepted
- 日期：2026-07-17

## 背景

Plugin-first 底座原计划并入 `@zhin.js/kernel`。实际迁移时发现旧 Kernel 同时承担
PluginBase、可变 Feature、Schedule、配置格式与工具函数，因此安装一个子路径仍会自动
携带 `yaml`、`smol-toml`、schedule、logger 与 schema。Root Runtime 的隔离安装增长到
5.90MB，违反 5MB 门禁。

## 决策

Plugin tree、Scope、Capability Slot、RuntimeSnapshot、generation lease、handoff 与
RootController 组成独立正式包 `@zhin.js/plugin-runtime`。该包零生产依赖，是所有新 Feature
provider 与 Root Runtime 的底层基础。

`@zhin.js/kernel` 暂时保留旧 PluginBase、Feature、Schedule 和工具接口，只服务存量代码。
旧接口迁移完成前，不从 Plugin Runtime 反向依赖 Kernel，也不通过 Kernel 子路径暴露新底座。

## 结果

- 新能力不会继承旧 Kernel 的格式解析和调度依赖。
- Feature Kit 及领域 Feature 可以保持轻量、独立发布。
- 旧 Kernel 可以按 ownership 分批拆除，而不阻塞 Root Runtime 与 HMR 迁移。
- 最终是否保留 `@zhin.js/kernel` 包名由旧 API 删除阶段决定，不影响 Plugin Runtime interface。
