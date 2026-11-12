---
title: 初始化与引导
description: 新项目第一次打开 Console：数据库、所有者、AI、聊天平台四步引导，每一步用什么凭据、需要什么权限、对应哪个 CLI 命令
---

# 初始化与引导

`create-zhin-app` 只建一个最小项目（[ADR 0053](../adr/0053-console-onboarding.md)）。数据库、所有者账号、AI 与适配器都在 Host 启动后由 Console 引导完成。引导由管理网关提供，实例还没起来也能做。

## 打开引导 {#open}

```bash
npm create zhin-app my-bot     # 只问：语言、项目名、初始化令牌
cd my-bot
pnpm dev                       # = zhin start --foreground --watch source config
```

创建结束时（以及 `zhin start` 启动后）终端打印一条 Console 链接：

```text
https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8068#token=<初始化令牌>
```

- 令牌在 `#` 之后，不会发送到 console.zhin.dev 的服务器；Console 读取后立即从地址栏移除。第一次连接未知 Host 时会请你确认。
- 非交互终端（CI 日志）只打印不带令牌的链接，令牌在 `.env` 的 `HTTP_TOKEN`。
- 链接丢了：打开 [console.zhin.dev](https://console.zhin.dev)，API Base 填 `http://127.0.0.1:8068`（以 `http.port` 为准），令牌填 `HTTP_TOKEN`。

## 五个步骤 {#steps}

| 步骤 | 凭据 | 做什么 | 需要的权限 |
| --- | --- | --- | --- |
| 1. 数据库 | 初始化令牌 | 选驱动（SQLite / MySQL / PostgreSQL / MongoDB），需要时在线安装驱动包，填连接、测试、保存 | — |
| 2. 所有者 | 初始化令牌 | 创建第一个所有者并登录；此后初始化令牌在所有接口上失效 | — |
| 3. AI | 所有者会话 | 是否启用 AI；安装 AI 依赖；添加第一个模型 Provider 并测试 | `plugin.manage` + `agent.configure` |
| 4. 聊天平台 | 所有者会话 | 选平台（可多选）、安装适配器包、为每个平台添加第一个账号并测试上线 | `plugin.manage` + `endpoint.manage` |
| 5. 完成 | — | 汇总，「完成，进入首页」 | `plugin.manage` |

- 第 3–5 步在 Console 的「开始使用」页（`/onboarding`）；引导未完成时，每个页面顶部都有「继续引导」横幅。
- 每一步都可以跳过，以后再回来。引导结束后：AI 在侧栏「AI 与模型」（`/features/ai`）设置；聊天平台先在「插件市场」安装适配器，再到「账号与会话」（`/scope`）的「接入新平台账号」进入该适配器页添加账号（见[接入账号](./index.md#connect-account)）。用的是同一组接口。
- 暂时不接平台时，可以先在侧栏「试聊一下」里和机器人对话。
- **数据库**：保持默认 SQLite（`.zhin/data.sqlite`）就能继续。配置里已显式写了 `database` 时默认跳过此步。保存前必定先测试连接；机密字段写进 `.env`，配置里只留 `${…}` 引用。换库后网关重新连接新库并重启实例；旧库里的插件数据不会迁移。
- **在线安装**只能装官方目录里的包：数据库驱动（`mysql2`、`pg`、`mongodb`）、适配器包、AI 依赖与插件市场条目。用初始化令牌只能装数据库驱动；其他安装走网关的依赖事务（停实例 → 安装 → 启实例，失败回滚），见[依赖安装与回滚](./operations.md#packages)。
- 没有配置 `http.token` 的本地 Host 在初始化前对所有人开放（只适合本机开发）；公网部署务必先配好 `http.token`。

## 引导状态 {#state}

进度存在 `.zhin/onboarding.json`（不放数据库里，因为第 1 步之前还没有确定数据库）：

```json
{ "version": 1, "steps": { "database": "done", "owner": "done", "ai": "skipped", "adapters": "pending" } }
```

| 接口 | 说明 |
| --- | --- |
| `GET {base}/auth/setup` | 初始化状态与 `onboarding` 字段（初始化令牌） |
| `GET {base}/auth/me` | 持有 `plugin.manage` 的调用方也会拿到 `onboarding` |
| RPC `onboarding.update` | `{ step: 'ai' \| 'adapters' \| 'finish', status: 'done' \| 'skipped' }`；需要 `plugin.manage`，`ai` 另需 `agent.configure`，`adapters` 另需 `endpoint.manage` |

已有项目升级后，配置里已经有的数据库 / 适配器 / AI 步骤自动标为完成，只剩创建所有者。

## 命令行对等 {#cli}

引导的每一步都是同一个服务的方法，CLI 与 Web 只是两个外壳，校验与写入结果一致：

| 步骤 | 命令 |
| --- | --- |
| 1、2 | `zhin console init`；非交互：`printf '%s\n' "$PASSWORD" \| zhin console init --yes --owner admin --password-stdin`（可加 `--database <dialect> --database-<字段> <值>`） |
| 3 | `zhin setup --ai` |
| 4 | `zhin setup --adapters` |
| 查看状态 | `zhin console init --status` |

## 相关

- [快速开始](../getting-started/index.md)
- [访问控制](./access-control.md)：引导之后怎么加用户、发 API 令牌
