# 目标结构草图

这是一个按需裁剪的重构目标，不是要求创建全部目录。

```text
my-plugin/
├── package.json
├── plugin.ts
├── schema.json
├── commands/
│   └── status/index.ts
├── middlewares/
│   └── audit/index.ts
├── handlers/
│   └── message-receive/index.ts
├── components/
│   └── status-card/index.tsx
├── schedules/
│   └── daily-report/index.ts
├── tools/
│   └── health/index.ts
├── hooks/
│   └── audit/index.ts
├── skills/
│   └── diagnostics/SKILL.md
├── agents/
│   └── operator/
│       ├── agent.json
│       ├── system.md
│       ├── boundaries.md
│       └── conventions.md
├── mcps/
│   └── service/index.ts
├── pages/
│   └── dashboard/index.tsx
└── src/
    ├── service.ts
    └── domain.ts
```

## 最小保留原则

- 没有某类能力，就不创建对应目录。
- `plugin.ts` 只装配资源和生命周期。
- 能力入口使用约定目录并 default-export 对应 `define*` 定义。
- 普通 helper 与共享业务实现放 `src/`，不参与能力发现。
- Agent/Skill 私有 Tool 留在所属目录，维持渐进披露。

只有装配逻辑时可收缩为 `package.json`、`plugin.ts` 和按需的 `schema.json`。只有一个命令时也应使用 `commands/<name>/index.ts`，不要回退到命令式注册。
