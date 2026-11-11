---
sidebar: false
---

# ADR 0053：Console 引导——create-zhin 只建项目，其余在 Console 完成

状态：Accepted（2026-11-11）

## 背景

`create-zhin` 目前在终端里问完所有问题：语言、项目名、模板、配置格式、Console 令牌、数据库、适配器、AI、开发技能，然后一次性生成依赖。问题是：

- 终端问答没法测试连接、没法预览，填错了只能手改配置文件；
- 数据库、适配器、AI 的依赖在创建时就要决定，之后改要重来一遍；
- ADR 0049 已经让 Console 能在线完成数据库初始化，同样的事做两遍。

## 决策

### 1. create-zhin 只做三件事

1. 项目名与语言；
2. 确认初始化令牌（`http.token`，默认随机生成，回车确认）；
3. 生成最小项目（IM 核心 + Console Host，不含数据库驱动、适配器、AI 依赖），安装依赖。

结束时打印：

```
✔ 项目已创建：my-bot
  启动：cd my-bot && pnpm dev
  然后打开 Console 完成初始化：
  https://console.zhin.dev/?apiBaseUrl=http://127.0.0.1:8086/api#token=<初始化令牌>
```

- 模板、配置格式、开发技能等保留为命令行参数（`--template`、`--config-format`、`--dev-skills`），不再交互提问，取默认值。
- 自动化场景保留非交互参数：`--database`、`--adapter`、`--ai` 等原有参数仍然生效，传了就按原逻辑写入；不传就留给 Console。`-y` 只确认默认值，不再预装适配器 / AI。
- 链接沿用 Console 现有格式（`?apiBaseUrl=` + `#token=`）：令牌放在 `#` 之后，不会发送到 console.zhin.dev 的服务器，Console 读取后立即从地址栏移除；未知 Host 先让用户确认。端口与 base 取自生成的配置。

### 2. Console 引导（onboarding）

Host 启动后、引导完成前，Console 显示引导流程，可以随时跳过某一步、以后再回来。

| 步骤 | 凭据 | 内容 | 对应的已有能力 |
|---|---|---|---|
| 1. 数据库 | 初始化令牌 | 选择驱动、安装驱动依赖、填写连接、测试、保存（需要时重启） | ADR 0049 §7–8 |
| 2. 所有者 | 初始化令牌 | 创建第一个所有者并登录；此后初始化令牌失效 | ADR 0049 §5 |
| 3. AI | 所有者会话（`plugin.manage` + `agent.configure`） | 是否启用 AI；安装 AI 依赖（`@zhin.js/agent` 及所选 Provider 的 SDK）；添加第一个模型 Provider 并测试 | 插件安装、模型路由页 |
| 4. 适配器 | 所有者会话（`plugin.manage` + `endpoint.manage`） | 选择平台（可多选）；安装适配器包；为每个平台填写第一个账号连接并测试上线 | 插件市场、适配器页（ADR 0052） |
| 5. 完成 | — | 汇总，进入仪表盘 | — |

- 初始化令牌只能做第 1、2 步。第 3 步起用所有者会话，走正常的 RBAC 权限检查。
- 第 3、4 步也可以在引导结束后，从「功能 → AI 与模型」「功能 → 适配器」随时进入，用的是同一组页面与接口，引导只是把它们串起来。

### 3. 在线安装依赖

引导与插件市场共用一条安装路径（现有 `plugin:install`）：

- 在项目根目录用项目的包管理器执行安装，输出以流的方式推给 Console，完成后按需重启 Host。
- 白名单：只能安装官方目录里列出的包——数据库驱动（`mysql2`、`pg`、`mongodb`，来自 `DATABASE_DIALECT_DEFINITIONS`）、适配器包与 AI 依赖（来自 `@zhin.js/scaffold-wizard` 的适配器 / AI 定义）、以及插件市场条目。
- 用初始化令牌只能安装数据库驱动；其他安装需要 `plugin.manage`。
- 这取代 ADR 0049 §8「驱动缺失时提示手动安装，不在线安装」：现在在线安装，手动安装仍然可以。

### 4. 引导状态

`.zhin/onboarding.json`：`{ version: 1, steps: { database, owner, ai, adapters: 'pending' | 'done' | 'skipped' }, completedAt? }`。

- 放在文件而不是数据库里，因为第 1 步之前还没有确定数据库。
- 接口：`GET /auth/setup`（ADR 0049）的返回加上 `onboarding` 字段；`onboarding.update`（RPC，`plugin.manage`）标记第 3–5 步完成或跳过。
- 已有项目（配置里已有数据库 / 适配器 / AI）升级后：已配置的步骤自动标为 `done`，只剩所有者需要创建。

### 5. CLI 对等

与 ADR 0049 §7 一致，引导的每一步都是同一个服务的方法，CLI 与 Web 只是两个外壳：

- `zhin console init`：第 1、2 步。
- `zhin setup`：第 3、4 步（复用 scaffold-wizard 的适配器 / AI 提问），安装与写入调用与 Console 相同的服务。

## 落盘位置

- create-zhin：`packages/toolkit/create-zhin/src/`
- 引导服务、安装白名单：`basic/cli/src/plugin-runtime/console/onboarding/`
- Console：引导流程页面（`/onboarding`）与入口横幅

## 后果

- 新用户在终端里只需回答两个问题。
- 数据库、AI、适配器的依赖可以在 Console 里随时增减，不必重建项目。
- Host 获得在 Console 里安装白名单包的能力；只有所有者（和初始化阶段的数据库驱动）能触发。
