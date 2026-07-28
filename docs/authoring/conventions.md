# 约定目录

插件包根目录下的一组**约定目录**会被 Feature 发现机制自动扫描：每个目录对应一个 Feature 包（feature provider），目录里的文件按命名规则映射为能力（capability），无需手动注册。发现流程：

```mermaid
flowchart LR
  A[插件包根目录] --> B[Feature provider<br/>按约定目录扫描]
  B --> C{命名规则匹配?}
  C -->|是| D[加载模块/文本<br/>validate 校验]
  C -->|否| E[跳过]
  D --> F[CapabilitySlot<br/>owner\0feature\0localName]
  F --> G[Index 投影<br/>CommandIndex / ToolIndex / …]
```

- 能力的完整 id 形如 `owner\0feature\0localName`（`\0` 分隔），`localName` 由目录内的相对路径决定。
- 同一 owner 下 `localName`（或同一文件来源）重复会抛 `DiscoveryConflictError`。
- 目录不存在或没有匹配文件时该 Feature 静默跳过——插件可以只声明自己用到的目录。
- `target: server` 的模块在 Node 侧加载执行；`target: client`（pages）经构建产物在浏览器加载。

## 目录全表

| 目录 | 文件形态 | 递归 | target | Feature 包 | featureId | 默认导出 |
| --- | --- | --- | --- | --- | --- | --- |
| `commands/` | `.ts` / `.tsx`，支持动态参数文件 | 是（子目录拼层级） | server | `@zhin.js/command` | `zhin.command` | `defineCommand(...)` |
| `middlewares/` | `.ts` | 是 | server | `@zhin.js/middleware` | `zhin.middleware` | `defineMiddleware(...)` |
| `components/` | `.ts` / `.tsx` | 是 | server | `@zhin.js/component` | `zhin.component` | `defineComponent(...)` |
| `adapters/` | `.ts` | 是 | server | `@zhin.js/adapter` | `zhin.adapter` | `defineAdapter(...)` |
| `tools/` | `.ts` | 否 | server | `@zhin.js/tool` | `zhin.agent-tool` | `defineAgentTool(...)` |
| `skills/` | 子目录 + `SKILL.md` | 一层 | server | `@zhin.js/skill` | `zhin.skill` | Markdown 文本 |
| `agents/` | `*.agent.md` | 否 | server | `@zhin.js/agent-feature` | `zhin.agent` | Markdown 文本 |
| `mcp/` | `.ts` | 否 | server | `@zhin.js/mcp-feature` | `zhin.mcp` | `defineMcp(...)` |
| `pages/` | `.ts` / `.tsx`，含 `$nav` / `$footer` 布局槽 | 否 | client | `@zhin.js/page` / `@zhin.js/layout` | `zhin.page` / `zhin.layout` | 页面构件 |

## 命名规则

通用段规则（目录名、普通文件名去扩展名后）：必须匹配 `^[a-z0-9][a-z0-9-]*$`，即小写字母/数字开头、可含连字符。不匹配的文件被跳过。

各目录的补充规则：

| 目录 | localName 推导 | 示例 |
| --- | --- | --- |
| `commands/` | 子目录与文件名用 `/` 拼接；动态参数文件 `[name:type=default].ts(x)` 映射为 `$name` 段，`type ∈ string\|number\|boolean`，`=default` 可省 | `commands/lottery-today.ts` → `lottery-today`；`commands/lottery/[game:string=].ts` → `lottery/$game` |
| `middlewares/` | 相对路径去扩展名，`/` 拼接 | `middlewares/keyword-reply.ts` → `keyword-reply` |
| `components/` | 同上 | `components/share-music.ts` → `share-music` |
| `adapters/` | 同上 | `adapters/napcat.ts` → `napcat` |
| `tools/` | 文件名去扩展名（不递归子目录） | `tools/music-search.ts` → `music-search` |
| `skills/` | 子目录名即 localName，目录内必须含 `SKILL.md` | `skills/memory-consolidate/SKILL.md` → `memory-consolidate` |
| `agents/` | 文件名去掉 `.agent.md` 后缀 | `agents/planner.agent.md` → `planner` |
| `mcp/` | 文件名去扩展名（不递归） | `mcp/my-server.ts` → `my-server` |
| `pages/` | 文件名去扩展名；`$nav.tsx` / `$footer.tsx` 是布局槽（同 slot 同时有 `.ts` 和 `.tsx` 时以 `.tsx` 为准） | `pages/orchestration.tsx` → `orchestration`；`pages/$nav.tsx` → `nav` |

命令动态参数文件的方括号语法写错（如不支持的类型）会抛 `CommandPathSyntaxError`，提示 `expected [name:string|number|boolean=default].ts(x)`。

## 各目录的最小形态

### commands/ — `defineCommand`

```ts
// plugins/utils/lottery/commands/lottery-today.ts
import { defineCommand } from '@zhin.js/command';

export default defineCommand<LotteryConfig>({
  description: 'Show today published recommendation report',
  async execute({ owner, use }) {
    const db = resolveLotteryRuntime({ owner, use })?.db ?? getLotteryDb();
    if (!db) return '数据库未就绪';
    // …返回字符串即回复
  },
});
```

### middlewares/ — `defineMiddleware`

```ts
// plugins/utils/group-suite/middlewares/keyword-reply.ts（节选）
import { defineMiddleware } from '@zhin.js/middleware';

export default defineMiddleware<Message, GroupSuiteConfig>({
  target: 'inbound',
  async handle(context, next) {
    const config = resolveGroupSuiteConfig(context.config);
    if (!config.keywordReply) {
      await next();
      return;
    }
    // …命中关键词则回复，否则 await next() 放行
  },
});
```

### adapters/ — `defineAdapter`

```ts
// plugins/adapters/napcat/adapters/napcat.ts（节选）
import { defineAdapter } from '@zhin.js/adapter';

export default defineAdapter<NapCatAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveNapCatConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    return new NapCatWsEndpoint({ id: context.id, gateway, config });
  },
});
```

`capabilities` 至少含 `inbound` / `outbound` 之一；`create` 返回的 Endpoint 生命周期见 [WS/SSE 端点生命周期](./endpoint-lifecycle.md)。

### tools/ — `defineAgentTool`

```ts
// plugins/utils/music/tools/music-search.ts（节选）
import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool<{ keyword: string; source?: MusicSource; limit?: number }>({
  description: '搜索音乐并返回结果列表',
  inputSchema: {
    type: 'object',
    properties: { keyword: { type: 'string', description: '搜索关键词' } },
    required: ['keyword'],
  },
  approval: 'never',
  execute: ({ keyword, source, limit }) => searchMusic(String(keyword), source, limit ?? 5),
});
```

### skills/ 与 agents/ — Markdown

`skills/<name>/SKILL.md` 带 frontmatter（`name` / `description` / `tools` 白名单等），如 `examples/full-bot/skills/memory-consolidate/SKILL.md`：

```markdown
---
name: memory-consolidate
description: 回合末或 master 说「记住」时，将 1–3 条可检索事实写入 memory_entries
tools:
  - memory_upsert
  - memory_search
---
```

`agents/<name>.agent.md` 是 Agent 人格/指令文件，如 `examples/multi-agent-room/agents/planner.agent.md`。

### pages/ — Console 页面

`pages/*.tsx` 编译为浏览器产物，挂进 Remote Console；`examples/full-bot/pages/orchestration.tsx` 是现成例子。`$nav.tsx` / `$footer.tsx` 由 `@zhin.js/layout` 消费，注入导航与页脚。

## 仓库实例速查

| 目录 | 实例 |
| --- | --- |
| commands | `plugins/utils/lottery/commands/`（含动态参数 `[game:string=].ts`） |
| middlewares | `plugins/utils/group-suite/middlewares/`、`plugins/games/*/middlewares/` |
| components | `plugins/utils/music/components/share-music.ts` |
| adapters | `plugins/adapters/napcat/adapters/napcat.ts` |
| tools | `plugins/utils/music/tools/`、`plugins/utils/group-suite/tools/` |
| skills | `examples/full-bot/skills/memory-consolidate/` |
| agents | `examples/multi-agent-room/agents/` |
| pages | `examples/full-bot/pages/orchestration.tsx` |
