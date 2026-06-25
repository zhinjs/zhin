# life-assistant-bot ACCEPTANCE

## Stable（Core）

- [ ] `pnpm install && cd examples/life-assistant-bot && pnpm dev` 可启动
- [ ] Sandbox 入站 `hello` 返回回复
- [ ] `ai:` 前缀触发 AI 对话（需 Ollama）
- [ ] `knowledge_search` 工具可检索 `knowledge/faq.md`
- [ ] Remote Console 连接 `http://127.0.0.1:8086`

## 生活助手

- [ ] `/remind` 命令返回确认
- [ ] `/mood` 命令记录心情
- [ ] `get_current_time` 工具返回当前时间
- [ ] 三层记忆目录结构存在（`data/memory/`）
- [ ] 配置契约测试通过：`pnpm vitest run examples/life-assistant-bot/tests/config-contract.test.ts`

## Home Assistant（实机，2026-06-25）

按 [assistant-home-setup.md](../../docs/advanced/assistant-home-setup.md) 在真实 HA 环境验收（#483）：

- [x] REST 通道控灯/实体（至少 1 个实体，如客厅灯）
- [x] profile `devices` 别名 → `home_*` 工具
- [x] IM 私聊触发 + NotificationRouter 回执
- **已知限制**：REST 为主路径（无需 HA MCP）；需 HA 长期访问令牌与同网可达；`assistant.enabled: true` + profile `devices` 配置

## 不做

- toolSearch / MCP Mesh / 多 bot 同开
- plan mode / 终端 coding harness
