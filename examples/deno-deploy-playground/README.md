# Zhin · Deno Deploy Playground（真实运行时）

在 [Deno Deploy](https://docs.deno.com/deploy/getting_started/) 上运行 **真实 `zhin.js` 启动链**，而不是手写一套假路由。

## 跑的是什么

| 组件 | 来源 |
|------|------|
| 根插件 / `usePlugin()` | `@zhin.js/core` |
| `registerCoreServices` | 与 `packages/zhin/src/setup/register-core-services.ts` 同构（无 process 适配器） |
| `initAgentModule()` | `@zhin.js/agent`（`MessageDispatcher`、AI trigger、ZhinAgent） |
| 演示命令 `zt` / `help` | 真实 `MessageCommand`（`src/plugins/demo.ts`） |
| WebSocket 入站 | `PlaygroundWsAdapter`（对齐 sandbox 的 `emit('message.receive')` → `runInboundMessage`） |

**不包含**（需本地 Node / `test-bot`）：完整 `@zhin.js/http` Host、IM 适配器、Console REST/SSE（Edge 返回 501，请用 [Remote Console](../../docs/console-remote.md) 指向 Host API）。

本目录为 **Zhin Edge** 官方模板：单 `fetch` 入口 + Sandbox WS；Console UI 使用 GitHub Pages + 可配置 API Base。

## 本地运行

```bash
cd examples/deno-deploy-playground
cp .env.example .env   # 可选 OPENAI_API_KEY
deno task dev
# http://127.0.0.1:8000
```

## 部署（Deno Deploy）

1. [console.deno.com](https://console.deno.com/) → New App  
2. **No Preset** · **Dynamic** · Entrypoint **`main.ts`**  
3. Install / Build 留空；`deno.json` 已声明 `nodeModulesDir: auto` 以解析 `npm:zhin.js`  
4. 环境变量：`OPENAI_API_KEY`、`OPENAI_BASE_URL`（可选）

> Monorepo 子目录暂不支持 GitHub 一键导入时，可在本目录执行 `deno deploy`，或把此文件夹单独成库。

## 与本地 test-bot 的关系

```text
本地 test-bot:  zhin dev → setup.ts → 全插件 + sandbox 控制台 + 多适配器
本 Playground:  Deno.serve → 同上 setup 子集 → 仅 WebSocket playground 适配器
```

要在 QQ/ICQQ 上对话，请继续用 `examples/test-bot`；本应用用于 **边缘演示 Zhin 消息内核 + 可选 AI**。

## 目录

- `zhin.config.yml` — 与 test-bot 同格式的 AI / plugins 配置  
- `src/runtime/bootstrap.ts` — 启动入口  
- `src/plugins/demo.ts` — 业务命令  
- `src/adapter/playground-ws.ts` — WebSocket 适配器  
- `static/index.html` — 聊天 UI  

## 许可证

MIT
