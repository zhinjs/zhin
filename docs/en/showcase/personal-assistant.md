# Showcase: Personal Assistant

> Corresponding example: [`examples/life-assistant-bot`](../../examples/life-assistant-bot/)
> Keywords: local model, knowledge base, three-layer memory, scheduled tasks, zero cloud cost

## Scenario

A private assistant running on your own machine: can chat, remembers things, can search your notes, and reminds you on time.
No desire to hand data over to cloud vendors -- the model runs locally via Ollama.

## Why zhin

| Candidate | Reason for Passing |
|-----------|-------------------|
| Direct Ollama HTTP calls | Memory, tools, session compaction all need to be built from scratch; two weeks later it becomes a mess |
| Koishi / NoneBot | Strong plugin ecosystem, but the AI Agent surface (tool orchestration, memory, subtasks) is not a first-class citizen |
| LangChain scripts | A library, not a product: no IM integration, no management console, no permissions |

zhin's fit: **IM framework and AI are separable** -- in this case AI is fully local, but if you later want to connect QQ/WeChat you just add an adapter package, and the assistant logic stays unchanged.

## Deployment Architecture

```
┌────────────┐   ws    ┌─────────────────────────────────┐
│  Browser   │ ──────▶ │  zhin (life-assistant-bot)       │
│  Console   │  API    │  ├─ Sandbox adapter (local debug) │
└────────────┘  :8086  │  ├─ ZhinAgent (chat/tools/compaction) │
                       │  ├─ knowledge_search (knowledge base) │
┌────────────┐         │  ├─ Three-layer Markdown memory  │
│  Ollama    │ ◀────── │  └─ Assistant Runtime (scheduled tasks) │
│  :11434    │  HTTP   └─────────────────────────────────┘
└────────────┘
```

## Key Configuration (Sanitized)

```yaml
# zhin.config.yml
plugins:
  sandbox:
    endpoints:
      - context: sandbox
        name: assistant
        owner: assistant-user

ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
  knowledge:
    baseDir: ./knowledge        # My notes directory; knowledge_search auto-indexes
```

## Lessons Learned

1. **Short context window with local models**: qwen3:8b blows the context on long conversations. Solution: zhin's session compaction is built in,
   no need to implement it yourself; splitting large documents in `knowledge/` into smaller chunks significantly improves retrieval hit rate.
2. **Reminder tasks "stop bugging me"**: The assistant's scheduled tasks notify on failure by default.
   Set `assistant.defaults.notifyOnFailure: false` to turn it off.
3. **Console won't connect**: The Host token is in `.env` under `HTTP_TOKEN`.
   Enter `http://127.0.0.1:8086` + that token in Console -- no account system to configure.

## Future Extension Paths

- Add `@zhin.js/adapter-qq` -> Same assistant goes to QQ
- `pnpm add @zhin.js/speech` -> Voice input/playback
- Switch to a cloud model by just changing `ai.providers`; local and cloud can coexist for routing
