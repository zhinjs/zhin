# Console 插件管理闭环

## 目标

新项目用户只通过 Console Web，就能搜索、安装、配置、校验、启用、更新和卸载插件；过程中不需要手写 `package.json`、`zhin.config.yml` 或理解 instance key、Endpoint、generation 的内部关系。

CLI 与 Console 必须调用同一套项目级插件管理事务。Console 负责交互和可视化，CLI 负责脚本化入口，Runtime 负责校验、提交和发布 generation。

## 当前基础

- Marketplace 已提供搜索、详情和更新检查：`/pub/marketplace/search`、`/pub/marketplace/detail/*`、`/api/marketplace/updates`。
- Console 已能读取插件列表、详情和插件 schema。
- Config RPC 已支持带 revision 的配置读取和写入。
- `zhin install` 已能安装依赖并写入 `package.json#zhin.plugins` 与 `zhin.config.yml`。
- 插件生命周期已有启用/停用状态和重启通知，但还没有与安装事务合并。

本阶段已先落地：

- `plugin:plan-install` RPC 与 Console transport 方法；
- `plugin:install` RPC 与 CLI 共享安装事务：revision 校验、pnpm 安装、插件清单/配置写入和失败回滚；
- `plugin:validate-config` RPC 与 Console hooks：按插件 schema 校验类型、必填项、枚举和环境变量引用（同时检查进程环境与项目 `.env*` 文件）；
- `plugin:diagnose` RPC 与 Console hook：汇总安装计划、当前配置校验和环境变量缺失状态。
- Console client 已统一提供 Marketplace 搜索/详情/更新检查、已安装列表和插件启停 hooks。
- `plugin:plan-uninstall` / `plugin:uninstall` 提供精确包名确认、revision 校验，以及依赖、清单和配置的事务化移除；CLI `uninstall plugin --remove-pkg` 复用相同事务。
- `plugin:plan-update` / `plugin:update` 使用精确目标版本、revision 校验、安装后版本校验和清单/锁文件回滚。
- `endpoint.test` 从当前 generation 返回连接、登录等待、失败或未配置状态，供适配器配置向导验收。
- CLI 根据项目真实 `package.json` 计算 npm 插件的安装、挂载、配置变化和重启需求；
- CLI 与 Console 共用 `PluginManagementPort`，后续安装提交不再复制判断逻辑。

## 第一阶段：安装计划与提交

先建立项目级 `PluginManagementPort`，所有写操作先生成计划，再提交计划：

```text
discover → inspect → plan → confirm → install → configure → validate → publish → verify
```

安装计划必须包含：

- 包名、目标版本和来源；
- 当前项目与 Node/pnpm 兼容性；
- 新增或变化的依赖；
- `package.json#zhin.plugins` 变化；
- `zhin.config.yml` 变化；
- schema 必填项和缺失环境变量；
- 数据库、Agent、MCP、媒体等可选能力要求；
- 是否需要重启或新 generation；
- 回滚所需的文件和依赖快照。

Console 首先接入只读 `plugin:plan-install`，确认后再调用 `plugin:install`。两者都必须带项目配置 revision，避免两个页面同时覆盖配置。

## 第二阶段：配置和 Endpoint 工作台

插件配置页使用 schema 表单，保留原始 YAML 编辑器作为高级入口。表单需要显示：

- 当前值和默认值；
- 环境变量引用、来源和缺失状态；
- 字段说明、示例和敏感字段遮罩；
- Endpoint 列表和连接测试；
- 保存后的 restart/generation 结果。

适配器安装和 Endpoint 创建合并为一个向导：选择平台、连接模式、账号配置、测试连接、保存并启用。

## 第三阶段：生命周期、更新和诊断

插件详情页统一提供：

- enable / disable / reload；
- update / rollback；
- uninstall / remove package；
- 日志、健康状态和当前 generation；
- 依赖、权限和资源使用说明。

更新必须展示变更计划，成功发布新 generation 并完成健康检查后才算成功；失败时恢复到上一个可运行状态。

## 验收标准

1. 新建项目后在 Console 搜索一个官方插件，完成安装、配置和启用，不手写配置文件。
2. 缺少环境变量或依赖时，在提交前显示可执行的修复建议。
3. 安装、配置和启用任一步失败，都不会留下半完成清单。
4. CLI 和 Console 对同一插件产生相同的 manifest、配置和校验结果。
5. 配置保存后能明确显示：已发布、需要重启、校验失败或等待配置。
6. Marketplace、已安装插件、运行时能力和 Endpoint 状态可以互相跳转。

## 非目标

本阶段不优先处理旧插件迁移，也不把所有 Runtime 概念隐藏掉；只把它们封装在插件安装和配置流程之后。
