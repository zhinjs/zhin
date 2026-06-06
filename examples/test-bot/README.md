# test-bot（厨房水槽 · Advanced）

> **这不是默认入门模板。** 新用户请使用 [`../minimal-bot`](../minimal-bot/)（Stable 黄金路径）。  
> 能力验收见 [ACCEPTANCE.md](./ACCEPTANCE.md)（Stable vs Advanced）。

Zhin.js 维护者用**全功能**机器人：多适配器、toolSearch、MCP、多 bot 同开，用于回归与 Advanced 验收。

## 维护者运行手册

### Monorepo 前置条件

在**仓库根目录**完成一次全量准备（test-bot 依赖 workspace 包，不可单独 `npm install` 后裸跑）：

```bash
cd /path/to/zhin
pnpm install
pnpm build   # 或至少构建 logger / cli / core / agent / zhin / 本示例引用的 adapters
```

- Node.js `^20.19.0 || >=22.12.0`，pnpm 9+
- 复制 `examples/test-bot/.env.example` → `.env`，按 `zhin.config.yml` 填各适配器凭据

### 启动与验收

```bash
cd examples/test-bot
pnpm dev      # 开发模式（热重载）
pnpm start    # 生产模式
```

| 文档 | 用途 |
|------|------|
| [ACCEPTANCE.md](./ACCEPTANCE.md) | Stable / Advanced 验收清单与 `pnpm check:stable` 命令 |
| [REMOTE_CONSOLE.md](./REMOTE_CONSOLE.md) | Host API + [zhin-console](https://github.com/zhinjs/zhin-console) 联调步骤 |
| [docs/console-remote.md](../../docs/console-remote.md) | Remote Console 架构与 CORS 说明 |
| [docs/adapters/index.md](../../docs/adapters/index.md) | 平台适配器矩阵（Stable / Advanced / Experimental 档位与各包文档） |

本目录 `zhin.config.yml` 启用多 bot（ICQQ、QQ 官方、GitHub、Sandbox 等）。**ICQQ** 须先 `icqq login`，配置里只写 QQ 号（`name`）；新增或切换平台时对照 [适配器索引](../../docs/adapters/index.md) 与包内 README。

## 功能

- 多适配器演示（ICQQ、Sandbox 等）
- 插件系统演示
- AI 工具和技能演示
- 命令和中间件演示
- JSX 组件渲染演示

## 项目结构

```
test-bot/
├── data/                # 数据目录
├── src/
│   └── plugins/         # 插件目录
│       ├── test-plugin.ts   # 综合测试插件
│       ├── test-jsx.tsx     # JSX 组件测试
│       └── ...              # 其他测试插件
├── package.json
├── tsconfig.json
└── zhin.config.yml      # 配置文件
```

## 测试插件功能

### 命令系统

测试插件注册了多种命令，演示参数解析、权限控制等功能。

### AI 工具

演示了 Tool 注册和 Skill 声明，让 AI 智能体调用工具。

### AI 配置（agents / routes）

`zhin.config.yml` 使用新格式：

| 旧字段 | 新位置 |
|--------|--------|
| `defaultProvider` | `ai.agents.zhin.provider`（指向 `ai.providers.<别名>`） |
| `agent.chatModel` | `ai.agents.zhin.model` |
| `providers.*.models`（可选） | 省略时 `ModelRegistry` + `GET /v1/models` 自动发现；显式列表用于锁定白名单（如 Cloudflare Workers AI） |
| `agent.allowedTools` / `disabledTools` / `agents.*.tools` | 已移除；工具由运行时发现 + `orchestratorTools` / TF-IDF |
| `agent.toolSearch` | 已移除；编排为默认 |

- 入站默认走 **`agents.zhin`**；带图且命中 `agents.vision` 时走 `agents/vision.agent.md`（识图）。文生图经 **`tool_search` + `run_deferred_task`** 或 **`spawn_task`**（**`agent: draw`**）+ `agents/draw.agent.md`，工具为 **`generate_image`**。
- 插件/MCP 工具在连接后进入运行时工具池，由 **`tool_search` / TF-IDF** 按任务选用。
- 子 agent 需 `agents/<name>.agent.md`（persona）；**不要**添加 `zhin.agent.md`。

### 多模态（Advanced）

在 `zhin.config.yml` 的 `ai.multimodal` 中可开启入站预处理与出站 base64 发布；Sandbox 发图 + `ai:` 触发识图（`vision` 路由），或调用 `analyze_media` 分析本地媒体。文生图：deferred Worker 或 **`spawn_task` + `agent: draw`** 调用 `generate_image`（默认智谱 `cogview-3-flash` / 可选 Cloudflare Flux）并由 IM 发出图片。操作指引见 [TOOLS.md](./TOOLS.md)。

### 文生图 / ICQQ 部署检查清单

1. `icqq login` 完成，且 `bots[].name` 与 QQ 号一致。
2. `.env` 中至少配置 `BIG_MODEL_API_KEY`（或启用的其它文生图 provider）。
3. `ai.providers.zhipu-vl.imageGeneration` 已设（test-bot 默认 `cogview-3-flash`）。
4. **Zhin 与 icqq 守护进程不在同一可访问文件系统时**：在 icqq bot 下取消注释 `outboundMedia: base64`（见 `zhin.config.yml` 与 [ICQQ 适配器 README](../../plugins/adapters/icqq/README.md)）。
5. 修改配置后重启 `pnpm start` / `pnpm dev`。
6. 验收：私聊 `ai: 画一只橘猫` → 日志有 `generate_image` → 收到图片段（非纯文字「已生成」）。

### 消息处理

演示了以下功能：
- 中间件系统
- 消息拦截与修改
- 消息回复

### JSX 组件

演示了 JSX/TSX 组件在消息中的渲染。

## 许可证

MIT License
