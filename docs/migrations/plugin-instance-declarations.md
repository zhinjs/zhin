---
title: 迁移到扁平插件配置
sidebar: false
---

# 迁移到扁平插件配置

这是一次配置格式的破坏性更新。Runtime 只接受 `configVersion: 2`，不再从
`package.json#zhin.plugins` 或 `.zhin/plugin-lifecycle.json` 组装应用实例。
旧格式只能由显式迁移工具读取，不能继续启动运行。

## 新配置的三个部分

在原 `zhin.config.yml` 中维护包映射、停用列表、同名业务配置：

```yaml
configVersion: 2

plugins:
  reminder: '@zhin.js/plugin-reminder'
  work-reminder: '@zhin.js/plugin-reminder'

disable_plugins:
  - work-reminder

reminder:
  timezone: Asia/Shanghai
  maxTasks: 20
  maxTasksPerSender: 10
  batchSize: 5
  missedGraceSeconds: 15

work-reminder:
  timezone: UTC
  maxTasks: 5
```

`plugins` 的键是实例名，值是已安装的 npm 包或 `./` 本地插件路径。没有出现在
`disable_plugins` 的实例默认启用。停用保留声明和业务配置，不卸载包，也不加载该实例入口。
同包多实例用不同名字，各自保存配置。插件内部继续通过 `context.config.get()` 读取当前实例的业务值。

Host、AI、数据库和 Root 自身 `plugin` 配置仍保留原位置。不要用 `ai`、`database`、
`http`、`plugin`、`plugins`、`disable_plugins`、`configVersion` 等保留键作为实例名。
实例名必须满足 Runtime 的校验；顶层重名会报错，不会覆盖 Host。

菜单的 `menuKeyword`、`menuStyle` 也是框架顶层配置，继续与 `plugins` 同级，不搬进 `plugin` 或实例业务块。Root 的 generation 配置视图包含这两个菜单设置，供 Command Feature 使用；子插件不会收到它们。

## 手动迁移

先停止正在运行的 Bot，使用包含本次变更的 CLI 版本，并备份项目 `package.json`、主配置和旧 lifecycle 文件，再执行以下搬移。
不要同时启动第二个已登录 Bot。迁移不需要读取 `.env` 中的密钥值。

| 旧位置 | 新位置 |
| --- | --- |
| `package.json#zhin.plugins` 中 `{ package, instanceKey }` | 主配置 `plugins.<instanceKey>: package` |
| 主配置 `plugins.<instanceKey>` 中的业务参数 | 主配置顶层 `<instanceKey>` |
| lifecycle 的 `disabled` 实例名 | 主配置 `disable_plugins` |

例如旧配置是：

```yaml
plugins:
  reminder:
    timezone: Asia/Shanghai
    maxTasks: 20
```

并且包清单挂载了 `@zhin.js/plugin-reminder`，实例名为 `reminder`，则改成：

```yaml
configVersion: 2
plugins:
  reminder: '@zhin.js/plugin-reminder'
reminder:
  timezone: Asia/Shanghai
  maxTasks: 20
```

然后移除项目 `package.json#zhin.plugins` 的旧挂载，退役旧停用状态。
**保留 npm dependencies、zhin.features、entry、engine 等包级契约。** 不要修改 `node_modules`
内已安装包的历史清单。保留 `${VAR}` 环境引用、业务参数、原实例名与持久化数据。

## 使用迁移 CLI

以下命令是本次更新提供的显式文件转换入口，不会登录平台、启动插件或调用模型：

```bash
# 先预览，不写文件
zhin migrate instances

# 审阅后应用；工具校验原文件版本并保留备份
zhin migrate instances --apply

# 原来使用了自定义 lifecycle 文件时显式指定
zhin migrate instances --lifecycle-file /absolute/path/plugin-lifecycle.json
```

工具只转换能保持身份与含义的项目。它不自动升级依赖、不加载第三方插件入口，
也不把文件转换成功当成平台或业务验证成功。inline Schema、Token 资源和实际装配要在后续启动时校验。

多文件转换中断时，先检查提示的迁移记录，再继续或回滚：

```bash
zhin migrate instances --recover continue
zhin migrate instances --recover rollback
```

未完成的迁移会阻止启动，避免混用半写状态。工具能检测已知 `.zhin.pid`，但无法证明所有手动启动的前台进程已停止；执行 `--apply` 前须自行确认停机。若文件已被他人修改，恢复操作会拒绝覆盖，
应先保留两份修改并人工核对；不要重复运行安装、登录或发消息来试探状态。

## 不能直接自动转换的情况

- **实例名与 Host/结构键碰撞**：先选择新名，并明确迁移持久化 owner。改名会改变
  `root/<实例名>`，不能把它当作纯显示名修改，也不能只改 YAML 就宣称数据迁移完成。
- **原有嵌套插件树**：首版扁平声明只支持 Root 直接实例。拆为根实例会改变父 Scope、解析包的位置
  和持久化身份，需人工调整依赖/资源契约后验证。工具应拒绝自动压平，不会静默丢掉子插件。
- **原有逐挂载 optional**：新格式没有该开关。明确决定将它变成启用的必需包，或安装后保留为
  停用实例。`disable_plugins` 与“缺包可跳过但装上后自动加载”语义不同，不应直接互换。
- **孤立业务块、失效 disabled 项、重复键或复杂 YAML 引用**：先修正歧义，工具不猜包名、不删用户数据。

迁移后运行 `zhin config check`，随后用原有进程入口启动，检查 Console 中的实例和 Endpoint 状态。
文件校验、generation 应用、平台连接就绪、实际业务验证是不同阶段；按需要分别核验。
