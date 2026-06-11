# Demo Console 运维手册

## Token 轮换

1. 在 VPS 上更新 `.env` 的 `DEMO_TOKEN`（及 `ADMIN_TOKEN` 若泄露）。
2. 重启 Host：`docker compose restart host`。
3. 用新 `DEMO_TOKEN` 重编 Demo Console（`VITE_API_TOKEN`）并替换 `console/dist/`。
4. 验证：Demo Token 调 `config:save-yaml` → 403；`ping` → 200。

## Ollama 模型

```bash
docker compose exec ollama ollama pull qwen3:8b
```

与 [examples/demo-bot](../../examples/demo-bot/zhin.config.yml) 中 `agents.zhin.model` 保持一致。

## 监控建议

- Host `GET /pub/health`（无需 Token）
- Nginx access log：异常 `POST /api/console/request` 量
- Ollama GPU 利用率；并发建议 ≤3（`limit_req` 已配 30 req/min/IP）

## 域名

| 域名 | 指向 |
|------|------|
| demo.zhin.dev | Nginx 静态 Console |
| demo-api.zhin.dev | Nginx → Host:8086 |

Cloudflare DNS：A/AAAA 到 VPS；SSL 模式 Full (strict) + Origin 证书。

## 故障排查

| 现象 | 检查 |
|------|------|
| Console 401 | `DEMO_TOKEN` 与前端构建一致 |
| WS 连不上 | Sandbox URL 是否带 `?token=`；demo scope 仅 `/sandbox` |
| ai: 无回复 | `docker compose logs ollama`；模型是否已 pull |
| CORS | `http.corsOrigins` 含 `https://demo.zhin.dev` |
