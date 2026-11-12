---
title: Zhin.js Playground
emoji: 🤖
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
license: mit
app_port: 7860
short_description: Zhin.js Plugin Runtime Sandbox playground
---

# Zhin.js Playground

在线体验 [Zhin.js](https://github.com/zhinjs/zhin) **Plugin Runtime**（`zhin start --foreground`：管理网关 + 受监管的实例）。

- Space：https://huggingface.co/spaces/zhinjs/demo （旧名 `zhinjs/zhin-playground` 会 307 到这里）
- App：https://zhinjs-demo.hf.space

## 怎么玩

1. 打开 App → [/sandbox](https://zhinjs-demo.hf.space/sandbox)（或 [/console](https://zhinjs-demo.hf.space/console) 进沙盒）
2. 或打开 [console.zhin.dev/?apiBaseUrl=https%3A%2F%2Fzhinjs-demo.hf.space](https://console.zhin.dev/?apiBaseUrl=https%3A%2F%2Fzhinjs-demo.hf.space)，用 Space 页面公布的只读账号 `demo` 登录（只能看，写操作返回 403）
3. 命令以 `/` 开头；AI 对话用前缀 `ai:` / `AI:` / `#`（例如 `ai: 你好`）

## 可用命令

| 命令 | 说明 |
|------|------|
| `/hello [name]` | 向你问好 |
| `/playground` | 查看帮助 |
| `/echo <msg>` | 复读消息 |
| `/time` | 查看服务器时间 |
| `/dice [faces]` | 掷骰子 |
| `ai: …` | OpenRouter `openrouter/free` Agent |

## 说明

- 栈：Plugin Runtime + Sandbox + `@zhin.js/agent`（OpenRouter free）
- Secrets（Space → Settings → Variables and secrets）：
  - `OPENROUTER_API_KEY`：模型 Key
  - `OWNER_PASSWORD`（推荐；可选 `OWNER_USERNAME`，默认 `maintainer`；至少 10 位）：启动前离线创建所有者，端口开放时初始化已完成，初始化令牌随即失效
  - `HTTP_TOKEN`：初始化令牌，只在创建所有者之前有效；**不要公开**。只有不设 `OWNER_PASSWORD`、要在 Console 里完成初始化时才需要。未设置时 `start.sh` 在内存里随机生成一个，不写日志
  - `OWNER_PASSWORD` 与 `HTTP_TOKEN` 都没设置时没人能完成初始化，`start.sh` 拒绝启动；密码过短同样直接报错退出（Space 显示 Runtime error 与原因）。账号创建后密码会从环境里移除，网关与实例看不到
  - `DEMO_PASSWORD`（可选 `DEMO_ROLE`，默认 `viewer`；至少 10 位）：创建公开的只读账号 `demo`；建议按 [部署演示站点](https://github.com/zhinjs/zhin/blob/main/docs/operations/demo-deployment.md) 换成去掉数据库 / 文件读权限的自定义角色；要让访客在 `/sandbox` 里发消息，角色还需要 `endpoint.operate`
- 数据库在容器内（`./data/playground.db`），Space 重启后重置；账号由 `start.sh` 按 Secrets 重新创建
- 模型声明在 `ai.plan.yml`（首次启动、数据库为空时自动导入）；启动策略在 `zhin.config.yml`（`configVersion: 2`）
- Host 由 `zhin start` 拉起的实例装配（HTTP 由管理网关承载）；仓库镜像：[`deploy/huggingface`](https://github.com/zhinjs/zhin/tree/main/deploy/huggingface)
