# Queue Edge 验收示例

最小路径：HTTP POST 入站 → `enqueueOutgoing` → `claim` → `executeOutbound`。

## Host（test-bot + queue-runtime）

在 `zhin.config` 启用 `@zhin.js/http` 后，队列 API（默认 `base: /api`）：

- `POST /api/queue/incoming` — Queue Envelope JSON
- `GET /api/queue/outgoing` — 列出出站记录
- `POST /api/queue/claim` — body `{ "workerId": "w1" }`

需将 `@zhin.js/queue-runtime` 注册到 Host（见 `packages/queue-runtime/CONTEXT.md`）。

## Edge（deno-deploy-playground）

```bash
cd examples/deno-deploy-playground
deno task dev
```

```bash
curl -s -X POST http://127.0.0.1:8000/api/queue/incoming \
  -H 'Content-Type: application/json' \
  -d '{"kind":"event","type":"demo","detail":{"hello":1}}'
```

Console（Edge 子集）：启动日志中的 `console=` 链接，或 **API Base URL** `http://127.0.0.1:8000`（与 Host 8086 同规则）；公开 `GET /pub/health`、`GET /pub/openapi.json`。Token 见 `.env` `HTTP_TOKEN`。
