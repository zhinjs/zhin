# minimal-bot（Stable 黄金路径）

Zhin.js **对外默认承诺**的最小示例：单 Sandbox bot、最少插件、关闭 `toolSearch` 与 MCP。

维护者全功能配置见 [`../test-bot`](../test-bot/)（厨房水槽）。

## 前置条件

- 在**仓库根目录**已执行 `pnpm install` 并完成 `pnpm build`（或至少构建 logger / cli / core / zhin / 本示例依赖的 adapters）。
- Node.js ^20.19.0 或 >=22.12.0，pnpm 9+。

## 30 分钟首跑

```bash
# 仓库根
cd /path/to/zhin
pnpm install

cd examples/minimal-bot
cp .env.example .env
pnpm dev
```

1. 确认终端里 Host 已启动（日志含 HTTP 端口，一般为 `8086`；**不要**在浏览器直接打开 `http://localhost:8086` 指望出现聊天页——Host 仅提供 API）。
2. 打开 **[Remote Console](https://console.zhin.dev)**（或本地 [zhin-console](https://github.com/zhinjs/zhin-console) 开发服，通常 `http://127.0.0.1:5173`）。
3. 登录：**API Base** `http://127.0.0.1:8086`（或 `http://127.0.0.1:8086/api`）；**Token** 与 `.env` 中 `HTTP_TOKEN` 一致（默认 `minimal-dev-token`）。
4. 在 Sandbox 窗口发送 `hello` → 应收到插件回复。
5. （可选）本地 [Ollama](https://ollama.com/) 运行后发送 `ai: 你好` 触发 AI 回合。

详见 [docs/console-remote.md](../../docs/console-remote.md)。

### 无 Ollama 时

仅验证 IM Stable 路径：步骤 2 即可。AI 需 Ollama 或配置 `OPENAI_API_KEY` 并将 `zhin.config.yml` 中 `ai.defaultProvider` 改为 `openai` 且补充 `providers.openai`。

## 配置说明

| 项 | 值 |
|----|-----|
| Bot | 仅 `sandbox` |
| Plugins | adapter-sandbox、http、console、hello |
| `ai.agent.toolSearch` | `false`（Advanced 能力在 test-bot 验证） |

## 验收

```bash
# 仓库根
pnpm check:stable
```

与 [`../test-bot/ACCEPTANCE.md`](../test-bot/ACCEPTANCE.md) 中 **Stable** 段一致；Advanced 项请勿在本目录期望通过。
