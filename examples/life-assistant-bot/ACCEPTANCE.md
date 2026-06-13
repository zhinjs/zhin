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

## 不做

- toolSearch / MCP Mesh / 多 bot 同开
- plan mode / 终端 coding harness
