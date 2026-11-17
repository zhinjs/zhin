---
sidebar: false
---

# ADR 0065：MCP 工具按聊天角色授权——上游标注只读的工具对所有人开放，其余默认只给全局 owner

状态：已接受（所有者 2026-11-17 批准）。依据：zhinjs/zhin#1250 评论 6934895336、6935017999，所有者原话：「让上游加权限验证，这样我们才能给 master 开全量，给普通用户开只读」。所有者 2026-11-17 批准了本文的 D1–D7 和默认值。核对基线：`origin/feat/friendly-volta-ejc3wl`（`4353901993dcc1a87e66c2120a079b6cae27d05c`）。实施进度：P0、P1 已实施（同一版本发布）；P2、P3 还没开始。

关联：[ADR 0056](./0056-chat-roles.md)（聊天角色、`<角色>@<层级>` 写法、`PermissionHost`、执行时复检）、[ADR 0036](./0036-controlled-landing-phase0.md)（危险工具硬闸）、[ADR 0049](./0049-console-rbac.md)（Console 权限映射：新增的接口要登记权限）、[ADR 0061](./0061-inbound-message-outcomes.md)（每个结局都要有原因：被隐藏的工具要进 trace）。

## 背景

所有者的要求是：同一个 MCP 服务器可以全部开放给主人（全局 `owner`），普通用户只能用其中的只读工具。现在做不到：插件工具能按聊天角色授权，MCP 工具完全绕开了这套机制。

### 1. 角色与插件工具的授权（ADR 0056）

- 角色分 `owner` ⊃ `admin` ⊃ `trusted` 三档，按「会话 → 账号 → 适配器 → 全局」取最高，写进 `sender.chatRole` 和 `sender.chatRoleLevels`；Agent 回合主体是 `principal.chatRole` / `principal.chatRoleLevels`。
- 「Agent 危险工具」（exec、写文件、敏感读等）要求**全局** `owner`，即 `owner@global`。
- 插件工具通过 `defineAgentTool({ permissions: [...] })` 声明谁能用（`packages/im/tool/src/definition.ts:201`）。列表各项是 AND 关系，每一项都是 permit DSL（`packages/im/permission/src/builtin.ts`）。判定入口是 `PermissionHost.checkAll`。
- 生产路径（Plugin Runtime）由 `CapabilityIngress` 判定：`canAccessDescriptor`（`packages/im/agent/src/plugin-runtime/capability-ingress.ts:383-418`）决定工具是否进本轮工具池；执行时 `assertStillAllowed`（`:448-457`）调用 `currentPermissionSubject`（`:425-445`），从角色存储重新读取发送者角色后再判一次。没有 `PermissionHost` 时 fail closed（`:415`）。

### 2. MCP 工具绕开了上面这套机制（逐项核实）

| # | 现状 | 位置 |
|---|---|---|
| G1 | 生产路径把 MCP 工具原样加进工具池：`expandMcpTools` 把绑定里每个服务器的全部工具展开成 `ToolCapability`，不带 `permissions`，也不经过 `canAccessDescriptor` | `packages/im/agent/src/plugin-runtime/agent-runtime.ts:357-361`（拼工具池）、`:509-540`（`expandMcpTools`） |
| G2 | 绑定按服务器整个开放：`AgentCapabilitySelection.mcpServers` 只有服务器名列表，`ai.agents.<name>.mcpServers` 的每一项只能写字符串 | `agent-runtime.ts:252-259`；`packages/im/runtime/src/host-config-schema.json:2201-2209`；`packages/im/agent/src/model-runtime/validation.ts:90-94` |
| G3 | 接入时丢掉了上游的 `annotations`（`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`）：投影只保留 `name` / `description` / `inputSchema`，描述符类型里也没有这个字段 | `packages/im/agent/src/plugin-runtime/host-mcp-projection.ts:48-52`；`packages/im/mcp-feature/src/definition.ts:5-9`；`packages/im/agent/src/mcp-client/bridge.ts:11-20`（`McpToolDefinition`）、`:41`（写死 `isReadOnly: false`） |
| G4 | 唯一按发起人收窄 MCP 工具的是信任档位 `applyTurnTrust`，它只按工具名识别 shell、写文件、发消息三类。名字像 `send_*` 的 MCP 工具对普通成员隐藏，`create_issue`、`delete_repo` 这类工具不受影响 | `packages/im/agent/src/security/trust-level.ts:99`、`:125-133`、`:159-172` |
| G5 | 执行前只走声明式审批：MCP 工具一律是 `requiresApproval: 'on-risk'` 且不是只读，所以每次调用都要审批；但 `execApprovalMode` 的默认值是 `auto`，审批交给自动审核，普通用户发起的写操作通过自动审核后就会执行 | `agent-runtime.ts:532`；`packages/im/agent/src/plugin-runtime/host/runtime-foundation.ts:164`；`packages/im/agent/src/security/policy-facade.ts:352-358` |
| G6 | 上游通知工具列表变化（`notifications/tools/list_changed`）时客户端不处理，工具列表只在建立连接时读一次 | `packages/im/agent/src/mcp-client/connection.ts:205-211` |

本轮的 MCP 工具来自绑定：IM 入口在 `packages/im/agent/src/plugin-runtime/ingress/ingress-turn-runner.ts:470` 传入 `binding.mcpServers`（弹幕回合传空列表），内容审核在 `ingress-moderation-stage.ts:309`，协议入口（A2A 等）在 `host/publication-coordinator.ts:62`，定时任务在 `host/assistant-runtime.ts:294`。

### 3. 与需求描述不一致的地方（以代码为准）

1. **`turn-pipeline.ts:155`、`prepare-turn-tools.ts:61`、`McpToolSource`（`packages/im/agent/src/tool/sources.ts:103-121`）、`getMcpToolsForBinding`（`packages/im/agent/src/resource-hub/mcp-lifecycle.ts:41-47`）属于旧的 `ZhinAgent.process` 路径。** 除测试和 eval 外，没有任何代码调用 `ZhinAgent.process` / `processStream`，生产回合都走 `AgentRuntime.execute` → `expandMcpTools`（G1）。旧路径同样不按角色过滤 MCP 工具；另外它组装工具时没有传 `permissionHost`（`prepare-turn-tools.ts:66-77`），带 `permissions` 的插件工具在这条路径上全部被拒（`packages/im/core/src/built/tool-access.ts:19`）。
2. **`PermissionToolFilter`（`sources.ts:123-129`）不判定任何权限**：它原样返回输入，也没有注册（`ToolSystem` 只注册了 `DedupeToolFilter`，`packages/im/agent/src/tool/tool-system.ts:42-44`）。插件工具的 permit 实际由 `canAccessTool`（旧路径）和 `canAccessDescriptor`（生产路径）判定。
3. **插件工具的字段名是 `permissions`（字符串数组）**；`permit` 是命令、中间件、按钮用的字段名。两者用同一套 DSL。
4. **DSL 里没有 `everyone` 和 `deny`**：插件工具不写 `permissions` 就是所有人可用，DSL 也没有「永不满足」的写法。本 ADR 的 `everyone` / `deny` 是 MCP permit 配置里的保留字，不加进 DSL（D2）。
5. **定时任务不是按创建者的原始角色运行的**：到期时先按创建者**当前**的角色重算（`currentScheduleCreator`，`packages/im/agent/src/assistant/job-creator.ts:75-89`），再统一降一档（`demoteScheduleCreator`，`packages/im/agent/src/schedule-domain/security-harness.ts:26-33`；`owner` → `trusted`，`trusted` / `admin` → `user`），回合主体只有 `roles`、没有 `chatRoleLevels`（`assistant-runtime.ts:257-266`；层级由 `turn-ingress.ts:510-516` 一律补成 `global`）。所以 D6「与现有 schedule 信任档位一致」的结果是：**全局 owner 创建的定时任务也拿不到默认「仅主人」的 MCP 工具**，只能用对 `trusted` 或所有人开放的工具。见 D6。
6. **协议入口的主体没有聊天角色**：A2A 是 `roles: ['user']`（`packages/host/a2a/src/agent-executor.ts:184`），zhin 自己的 MCP Server 入口是 `authenticated` / `localhost`（`packages/host/mcp/src/runtime.ts:225`）。跨进程 A2A Mailbox 的远端信件（`packages/host/a2a/src/mailbox-remote-transport.ts`）同样一律是 `user`、不带聊天角色：对端在信件里声明的 `authority.trust`（如 `trusted`）不映射成本地角色，签名只证明信件来自哪个对端（所有者 2026-11-17 决定；此前按声明的信任级别生成 `roles`，会被推导成 `trusted@global`）。新默认值下，这些入口也只能用只读 MCP 工具，开放给 `trusted` 的 MCP 工具和插件工具也用不了（见「迁移」）。

## 决策

### D1：接入时保留 `annotations`，转成工具自己的属性

1. `McpToolDescriptor`（`@zhin.js/mcp-feature`）新增可选字段：

   ```ts
   interface McpToolHints {
     readonly readOnly?: boolean;     // annotations.readOnlyHint
     readonly destructive?: boolean;  // annotations.destructiveHint
     readonly idempotent?: boolean;   // annotations.idempotentHint
     readonly openWorld?: boolean;    // annotations.openWorldHint
   }
   interface McpToolDescriptor { /* name, description, inputSchema */ readonly hints?: McpToolHints }
   ```

   `host-mcp-projection.ts` 的 `listTools` 和 `bridge.ts` 的 `mcpToolToAgentTool` 从上游 `tools/list` 结果读 `annotations`：只接受布尔值，其他类型当作没标注。上游的 `title` 等展示字段不读。
2. `expandMcpTools` 把 `hints` 放到 `ToolCapability.mcpHints`（新增可选字段）上，供 D3 定档、D5 展示和审批卡片使用。
3. **`hints.readOnly` 不写进工具已有的 `readOnly` 字段**。`readOnly: true` 是插件作者随代码一起发布的声明，会放宽默认 `on-risk` 审批（`policy-facade.ts:352-377`，#1250 b33）、让工具进入受限回合（弹幕，`turn/live-turn-context.ts:60`），还会让定时任务的重放判定当作安全（`schedule-domain/replay-evidence.ts:28`）。上游标注来自进程外的服务器，**只用来定权限档位（D3），不放宽审批**：MCP 工具仍是 `on-risk`，执行前照常走审批、FilePolicy、网络白名单和硬闸。
4. 语义按 MCP 规范：`destructive` 只在 `readOnly` 不为 `true` 时有意义；`readOnly: true` 与 `destructive: true` 同时出现视为矛盾，按「可能写」处理（D3）。`idempotent`、`openWorld` 本 ADR 只用于展示，不影响策略。

### D2：`ai.mcpServers[]` 的每一项支持 `permit`，复用 `PermissionHost`

配置格式（最终）：

```yaml
ai:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ['-y', '@modelcontextprotocol/server-github']
      permit:
        readOnly: everyone          # 上游标注 readOnlyHint=true、且没被 tools 命中的工具；缺省 everyone
        default: owner@global       # 其余工具（未标注、标注为写）；缺省 owner@global
        tools:                      # 按上游工具名（不带服务器前缀）覆盖；缺省 {}
          get_me: trusted
          search_*: everyone
          create_*: deny
          merge_pull_request: [owner@global, private(*)]
  agents:
    helper:
      mcpServers:
        - github                    # 字符串：只受服务器级 permit 约束
        - name: github              # 对象：再叠加一层，只能收窄
          permit:
            default: deny
            tools:
              get_me: everyone
```

`<permit>` 的写法：

| 写法 | 含义 | 判定 |
|---|---|---|
| `everyone` | 所有人 | 等价于插件工具不写 `permissions`（空列表） |
| `deny` | 谁都不能用 | 工具不展开：不进工具池、不能执行 |
| 一个 DSL 字符串，如 `trusted`、`admin`、`owner@global`、`role(owner@global,admin@adapter)`、`private(*)`、`platform:admin` | 与插件工具 `permissions` 里的一项相同 | `PermissionHost.checkAll([x])` |
| DSL 字符串数组，如 `[owner@global, private(*)]` | 各项都满足（AND），与插件工具 `permissions` 相同 | `PermissionHost.checkAll(list)` |

规则：

1. `everyone` / `deny` 只能单独出现，不能放进数组，也不加进 DSL；空数组是配置错误（要表达「所有人」写 `everyone`）。DSL 字符串在加载配置时用 `assertPermitSyntax` 校验，已移除的写法（`master`、`scene_admin`……）同样报错并给出替代。
2. `permit` 下只允许 `readOnly`、`default`、`tools` 三个键，其他键报错；三个键都可以省略，省略时取 D3 的默认值。
3. **单个工具的定档顺序**：
   1. `tools` 命中（匹配规则见 D7）→ 用命中的 permit；
   2. 否则上游标注 `readOnly: true` 且 `destructive` 不为 `true` → 用 `readOnly`；
   3. 否则 → 用 `default`。
4. **`ai.agents.<name>.mcpServers` 的覆盖只能收窄**：每一项可以是服务器名字符串，也可以是 `{ name, permit }`。对象形式的 `permit` 按同样的规则对同一个工具定出一档，**与服务器级的结果取 AND**（两层都满足才可用；任一层是 `deny` 就是 `deny`）。AND 只会变严，所以不需要比较两个 permit 谁更窄。Agent 层省略的键按 `everyone` 处理（不额外限制），**不是** D3 的默认值，因为服务器级已经兜底。同一个 Agent 里同名服务器只能出现一次，否则报错。
5. 实现上，`expandMcpTools` 把定出的 permit 转成 `ToolCapability.permissions`（`everyone` → 空列表，两层 AND → 列表拼接；`deny` → 不展开）。之后 MCP 工具与插件工具走同一个 `canAccessDescriptor` / `assertStillAllowed`，不另写判定逻辑。
6. `permit` 属于 `ai.mcpServers`，受自我变更策略保护：Agent 不能用 `self_change` 改它（`packages/im/agent/src/self-change/policy.ts` 的 `SELF_CHANGE_SECURITY_CONFIG_KEYS`）。Agent 层的 `ai.agents.<name>.mcpServers` 同样受保护（禁改名单里的 `ai.agents.*.mcpServers`）：删掉 Agent 层收窄或给绑定加服务器都会放宽工具面。

### D3：默认值偏安全

1. 不写 `permit` 等同于 `permit: { readOnly: everyone, default: owner@global, tools: {} }`：上游标注只读的工具所有人可用，其余只给全局 `owner`，与「Agent 危险工具」同一档。
2. 没标 `readOnlyHint`、标成 `false`、标了非布尔值，或与 `destructiveHint: true` 矛盾的，一律按「可能写」处理，归 `default`。
3. **这是行为变更**：已经绑给聊天 Agent 的服务器，升级后立刻按新默认值收紧：非全局 owner 只能看到上游标注只读的工具。要写进迁移说明（`docs/migrations/mcp-tool-permit.md` 和英文版）和 changeset，见「迁移与发布」。

### D4：每轮组装工具时按发送者过滤，执行前再判一次

1. 过滤发生在 `AgentRuntime.#executeLeased` 组装工具池的时候（`agent-runtime.ts:357-361`）：`expandMcpTools` 展开后、`applyTurnTrust` 之前，用 `canAccessDescriptor` 和本轮的 `turnPermissionSubject`（`principal.chatRole` / `chatRoleLevels`）判定。
2. 没有权限的工具不进 `capabilities.tools`，所以既不在模型的工具列表里，也不会出现在 `discover` / `load_tool` 的结果和延迟目录（`deferred-capability-plan.ts` 只读 `capabilities.tools`）里；`deferredTools.mcpServers.<name>.alwaysLoaded` 写了也不会常驻。模型看不到这些工具，也就不会去调用。系统提示不提被隐藏的工具。
3. 执行前再判一次：`expandMcpTools` 生成的 `execute` 先调用 `assertStillAllowed`（`current = true`，按角色存储里**当前**的角色），再 `callTool`。这能挡住会话历史里旧的工具调用被重放、回合进行中被撤销角色，以及子 Agent 沿用父回合能力的情况。拒绝时记一条 `tool_denied`，`policy: 'mcp-permit'`，原因用人话写（「这个 MCP 工具只对主人开放」）。
4. 子 Agent / 委派回合沿用发起人的主体（`collaboration/actor-turn.ts` 已经这样做），同一套过滤自然生效；P1 要有测试守住这一点。
5. 旧的 `ZhinAgent.process` 路径（背景 §3.1）：P1 在 `McpToolSource` 里套用同一个定档函数，并补上 `permissionHost` 传参，保证测试和 eval 与生产一致；删除整条旧路径另开任务。

### D5：`zhin status`、Console 和 trace 里看得到

1. `GET /introspection/mcp` 的行（`ConsoleMcpServerRow`，`packages/console/protocol/src/status.ts:67-74`）新增可选字段 `permit: { everyone: number; ownerOnly: number; custom: number; denied: number }`，按服务器级 permit 统计当前已连接的工具：`everyone` 是定档为 `everyone` 的个数，`ownerOnly` 是定档恰为 `owner@global` 的个数，其余 DSL 计入 `custom`，`deny` 计入 `denied`。
2. `zhin status`（`basic/cli/src/commands/lifecycle.ts:187`，读取逻辑在 `basic/cli/src/utils/runtime-state.ts:132-140`）在每个服务器后面显示「所有人可用 N 个 / 仅主人 M 个」，有自定义或禁用时再加「自定义 K 个 / 禁用 D 个」；`--json` 原样输出 `permit`。
3. 新增 `GET /introspection/mcp/tools?name=<server>`，返回每个工具的上游名、`hints`、服务器级定档结果，以及命中的来源（`tools:<模式>` / `readOnly` / `default`）。工具名和标注比连接状态敏感，所以权限是 `agent.view`，要登记进 `CONSOLE_HTTP_PERMISSIONS`（ADR 0049）。
4. trace 新增一条记录 `mcp_permit_withheld`：`{ tools: [{ server, tool, rule }], count }`，列出本轮因权限被隐藏的 MCP 工具（最多 50 个名字，其余只计数），不记录参数。没有工具被隐藏时不写。
5. 启动和连接完成时，`permit.tools` 里有条目没匹配到任何工具的，记一条警告（连接失败时不报，因为工具列表未知）；`zhin doctor` 同样提示。

### D6：定时任务按创建者的角色算，与现有 schedule 信任档位一致

1. 定时任务回合不另设规则，用的就是现有的定时任务主体：到期时按创建者当前角色重算（`currentScheduleCreator`），再按 `demoteScheduleCreator` 降一档。MCP 过滤读的就是这个主体（D4 第 1 条）。
2. 后果要写清楚：
   - 全局 owner 创建的任务以 `trusted` 运行，**默认拿不到「仅主人」的 MCP 工具**；需要让定时任务用某个写工具，就在 `tools` 里把它放宽到 `trusted`（例如 `create_issue: trusted`），或者给定时任务单独绑一个 Agent 并在该绑定里写明。
   - 普通用户创建的任务以 `user` 运行，只能用对所有人开放的工具。
   - 地址无法解析的创建者按 `user` 运行（fail closed，现有行为）。
3. 任务的执行计划点名了一个被隐藏的 MCP 工具时，会落入现有的 `missingTools`（`schedule-capability-plan.ts`），任务状态记为 `degraded`，trace 里有 `mcp_permit_withheld`。不新增状态。
4. P3 让定时任务主体带上 `chatRoleLevels`（按重算时的层级，降档后同步收窄），不再由 `turn-ingress.ts:510-516` 一律补成 `global`，这样 `trusted@global` 这类层级限定写法在定时任务里也按真实层级判定。

### D7：按工具名的白名单 / 黑名单是 `tools` 的特例

1. #1250 里提到的 `mcp-tool-allowlist`（按工具名开 / 关）不单独实现，用 `tools` 表达：
   - 黑名单：`tools: { create_*: deny, delete_repo: deny }`；
   - 白名单：`default: deny` 加上 `tools: { get_*: everyone, list_*: trusted }`。注意 `readOnly` 仍然生效，要做到「只放行列出的工具」，同时写 `readOnly: deny`。
2. 匹配规则：
   - 只匹配上游报告的原始工具名（不带服务器前缀，也不是模型看到的 `<qualifiedName>__<tool>`），区分大小写，不做 NFKC 或大小写归一；
   - 通配符只有 `*`，匹配任意长度（含空）的任意字符；不支持 `?`、`[]`、正则；
   - 名字里含非 ASCII 字符的工具只能被精确名命中，不会被带 `*` 的模式命中（防同形字借道宽松的通配规则）；
   - 优先级：精确名优先；没有精确名时，取字面字符最多的模式；字面字符数相同的多个模式**都要满足**（AND，任一为 `deny` 即 `deny`）。例：`create_issue` 同时命中 `create_*`（7 个字面字符）和 `*_issue`（6 个），取 `create_*`。
   - 同一个模式在同一层重复出现是配置错误。

## 安全考虑

1. **上游标注不可信**。标注是服务器自己声明的，服务器可能写错，也可能故意把写工具标成只读。应对：
   - 标注只能把工具放进 `readOnly` 档，不放宽审批（D1 第 3 条），写操作仍要经过审批和其他策略层；
   - 管理员可以用 `tools` 覆盖任何工具，包括把标成只读的工具收回给主人（`tools: { dangerous_tool: owner@global }`）；
   - 不信任某个服务器的标注，可以写 `readOnly: owner@global`，标注就不起作用；
   - Console 的工具明细（D5 第 3 条）把「上游声明只读」与「管理员规则」分开显示，方便发现标注可疑的工具。
2. **通配符**。`*` 会匹配以后新增的工具，所以宽松的通配（如 `search_*: everyone`）会把上游以后加的 `search_and_delete` 也开放给所有人。建议：放宽用精确名，收窄（`deny`、`owner@global`）用通配；Console 明细标出每个工具是被哪条模式命中的。非 ASCII 名字不参与通配（D7）。
3. **工具改名或新增**。工具列表只在连接时读取（G6），新工具在下次连接（新的 generation、重启或 Console「测试连接」后的重连）时出现，并按同一套规则定档：没标注就进 `default`，默认只给主人（fail closed）。改名的工具会丢掉原来的精确名规则，重新定档：原来按精确名放宽的会收紧（安全）；**原来按精确名 `deny` 的，改名后可能因为标了只读而对所有人开放**。所以禁用一类工具时优先用通配，或者用 `default: deny` 加白名单。精确名没匹配到工具时记警告（D5 第 5 条），改名能被发现。
4. **标注变化**。上游在两次连接之间把工具从写改成只读，工具就会放宽到 `readOnly` 档。`zhin status` 的计数变化可以看出来；P2 在连接完成时比较上一次的档位，有工具因标注变化而放宽时记一条警告。
5. **fail closed**。没有 `PermissionHost`、主体没有角色、角色层级缺失（按会话层，ADR 0056）、配置写错（启动报错），都不会把工具多放出去。
6. 被隐藏的工具名会写进 trace（D5 第 4 条）。trace 本来就在 `agent.view` 权限之后，不额外暴露。

## 备选方案及否决理由

| 方案 | 否决理由 |
|---|---|
| A. 另起一套 MCP 专用权限（自己的角色名、自己的判定器） | 与 ADR 0056 的角色、层级、执行时复检重复一遍，两套规则会漂移；Console 和文档要解释两套概念。复用 `permissions` + `PermissionHost` 后，MCP 工具与插件工具的判定是同一段代码 |
| B. 只做按名字的白名单 / 黑名单 | 只能决定「谁都能用」或「谁都不能用」，表达不了「主人全量、普通用户只读」；名字不说明读写，新增的工具要么全开、要么要管理员逐个维护 |
| C. 完全信任上游标注（标只读就放开，并且放宽审批） | 标注是上游自述，写错或恶意标注会直接让普通用户执行写操作而不经审批。本 ADR 只让标注决定档位，审批不变，管理员可以覆盖 |
| D. 按服务器授权（整台服务器只给某个角色） | 解决不了同一台服务器里读写混在一起的情况，而这正是所有者的需求 |
| E. Agent 层覆盖允许放宽 | 一个 Agent 绑定就能绕开服务器级的收紧，而绑定配置更分散、更容易漏审；AND 组合保证只能收窄 |

## 分阶段实施

发布级别按 `.changeset/version-policy.json`：默认 patch，新增公开导出、公开类型新增字段或行为变更需要所有者批准后升 minor，批准记录写进 `approvedNonPatchReleases`。

### P0：保留 annotations，加配置 schema（不改变行为）

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/mcp-feature/src/definition.ts`（`McpToolHints`、`McpToolDescriptor.hints`）、`mcp-index.ts`（`listTools` 透传 `hints`）；`packages/im/agent/src/mcp-client/bridge.ts`、`connection.ts`（读 `annotations`）；`packages/im/agent/src/plugin-runtime/host-mcp-projection.ts`；`packages/im/agent/src/resource-hub/types.ts`（`McpServerEntry.permit`）；`packages/im/agent/src/plugin-runtime/host/config.ts`（`toMcpServerEntry` 解析并校验 `permit`）；新模块 `packages/im/agent/src/plugin-runtime/mcp-tool-permit.ts`（解析、`assertPermitSyntax` 校验、D2 定档、D7 匹配，纯函数）；`packages/im/agent/src/config/agent-bindings.ts`、`config/types.ts`、`model-runtime/types.ts`、`model-runtime/validation.ts`（`ai.agents.<name>.mcpServers` 接受 `{ name, permit }`，`ResolvedAgentBinding` 新增 `mcpPermits`，`mcpServers` 仍是名字列表）；`packages/im/agent/src/config/agent-startup.ts`（类型）；`packages/im/runtime/src/host-config-schema.json`（两处 schema）；`pnpm check:config-reference` 重新生成的 `docs/configuration/generated.md` 和英文版 |
| 测试 | `packages/im/agent/tests/plugin-runtime/mcp-tool-permit.test.ts`（新：默认值、三步定档、矛盾标注、`everyone` / `deny`、数组 AND、Agent 层 AND、通配优先级与并列 AND、非 ASCII 名不参与通配、各种配置错误）；`host-mcp-projection.test.ts` 补 `hints` 透传和非布尔值丢弃；`packages/im/mcp-feature/tests` 补 `hints`；`validation` 的绑定格式测试 |
| 行为 | 只解析和保存，不过滤；配置写错时启动报错（新字段，旧配置不受影响） |
| 发布 | `@zhin.js/mcp-feature`、`@zhin.js/agent` minor（新增公开类型字段 `hints`、新增导出 `McpToolHints` 及定档函数）；`@zhin.js/runtime` patch（schema） |

### P1：每轮过滤，执行前复核（行为变更）

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/agent/src/plugin-runtime/agent-runtime.ts`（`AgentCapabilitySelection.mcpPermits`；`expandMcpTools` 生成 `permissions` / `mcpHints`、跳过 `deny`、`execute` 内复检）；`capability-ingress.ts`（导出 `canAccessDescriptor` / `assertStillAllowed` 给 `expandMcpTools` 用，或移到同目录的共享模块）；`ToolCapability` 新增 `mcpHints`；传入 `mcpPermits` 的四处入口：`ingress/ingress-turn-runner.ts`、`ingress/ingress-moderation-stage.ts`、`host/publication-coordinator.ts`、`host/assistant-runtime.ts`；`tool/turn-tool-runtime.ts`（`mcp-permit` 拒绝原因文案）；旧路径 `tool/sources.ts`（`McpToolSource` 套用定档）、`tool/prepare-turn-tools.ts`（传 `permissionHost`）；文档 `docs/ai/agent.md`、`docs/configuration/index.md` 及英文版；新增 `docs/migrations/mcp-tool-permit.md` 和 `docs/en/migrations/mcp-tool-permit.md` |
| 测试 | `agent-runtime.test.ts`：普通成员只看到只读工具，全局 owner 看到全部，会话层 owner 按 `admin` 计、看不到 `owner@global` 的工具；`discover` / 延迟目录 / `alwaysLoaded` 都不含被隐藏的工具；回合中撤销角色后执行被拒（`policy: 'mcp-permit'`）；重放一个当前不可见工具的调用被拒；子 Agent 继承过滤；Agent 层 `deny` 生效且不能放宽服务器级；`applyTurnTrust` 仍在过滤之后执行；旧路径 `tool-system.test.ts` 同样过滤 |
| 发布 | `@zhin.js/agent` minor（行为变更：默认收紧）；`zhin.js` 随依赖 patch。changeset 写明：升级后非全局 owner 只能用上游标注只读的 MCP 工具，恢复旧行为写 `permit: { default: everyone }`（不推荐） |

### P2：status、Console、trace 的显示

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/console/protocol/src/status.ts`（`ConsoleMcpServerRow.permit`、新接口的行类型与路径常量）、`permissions.ts`（登记 `GET /introspection/mcp/tools` → `agent.view`）；`packages/im/agent/src/plugin-runtime/host-mcp-status.ts`（连接时记录每个工具的 `hints` 和定档、标注变化警告）、`agent-host-port.ts`（`AgentHostMcpSummary.permit`，新增可选 `listMcpTools(name)`）、`host/publication-coordinator.ts`；`packages/im/zhin/src/instance/console/agent-runtime-resolver.ts`（合并行）；`packages/host/http/src/console-rest-pages.ts`、`console-rest-pages-helpers.ts`（新接口）；`basic/cli/src/utils/runtime-state.ts`、`commands/lifecycle.ts`（显示计数）、`commands/doctor.ts`（未匹配规则提示）；`packages/im/agent/src/trace/turn-trace.ts`（`mcp_permit_withheld`）及 `zhin trace` 的格式化 |
| 测试 | 协议权限映射测试（新路由已登记）；`host-mcp-status.test.ts`（计数、标注变化警告）；`publication-mcp-introspection.test.ts`；`basic/cli` 的 status 输出快照；trace 记录的上限与不记参数 |
| 发布 | `@zhin.js/console-protocol` minor（新增类型字段与路径常量）；`@zhin.js/agent` minor（新增可选端口方法、trace 记录变体）；`@zhin.js/host-http` minor（新接口）；`@zhin.js/cli` minor（status 输出新增字段） |

### P3：定时任务按创建者算

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/agent/src/assistant/job-creator.ts`（`currentScheduleCreator` 同时返回层级）、`assistant/types.ts`（`ScheduleJobCreator` 新增可选 `roleLevels`）、`schedule-domain/security-harness.ts`（降档时同步收窄层级）、`plugin-runtime/host/assistant-runtime.ts`（主体带 `chatRole` / `chatRoleLevels`）；文档 `docs/ai/` 中定时任务一节及英文版 |
| 测试 | `timer-due` / 定时任务回合测试：owner 创建的任务看不到默认仅主人的工具、能用 `tools` 放宽到 `trusted` 的工具；普通用户的任务只看到 `everyone`；执行计划点名被隐藏的工具 → `missingTools` 与 `degraded`；`trusted@global` 在会话层 trusted 创建的任务里不满足 |
| 发布 | `@zhin.js/agent` minor（`ScheduleJobCreator` 新增字段，公开类型） |

依赖：P0 → P1 → P2；P3 依赖 P1，可与 P2 并行。P1 是唯一的行为变更，P0 和 P1 最好在同一个版本里发布，避免出现「能写 `permit` 但不生效」的版本。

### zhinjs/console 仓库要做的部分

Console 前端在 zhinjs/console（ADR 0052）。本仓库提供 P2 的接口和协议类型，前端另开 issue：

1. MCP 页的服务器列表显示「所有人可用 N 个 / 仅主人 M 个」，有自定义或禁用时显示对应计数；旧实例没有 `permit` 字段时不显示。
2. 服务器详情新增「工具权限」表：工具名、上游标注（只读 / 破坏性 / 幂等，注明「上游声明」）、生效档位、命中来源（`tools` 模式 / 只读默认 / 其余默认）。数据来自 `GET /introspection/mcp/tools`，需要 `agent.view`。
3. 配置编辑：`ai.mcpServers[].permit` 由 schema 生成表单（`readOnly` / `default` 下拉：所有人、trusted、admin、仅主人、禁用、自定义；`tools` 为键值列表），保存前提示通配符会匹配以后新增的工具。
4. trace 视图显示 `mcp_permit_withheld`：「本轮因权限隐藏了 N 个 MCP 工具」，可展开看名字。

## 迁移与发布

- 升级后，已经绑定 MCP 服务器的聊天 Agent 对非全局 owner 只开放上游标注只读的工具。多数官方 MCP 服务器（如 GitHub、文件系统）已经给读工具标了 `readOnlyHint`；没有标注的服务器，普通用户在升级后会看不到它的任何工具。
- A2A、zhin 自己的 MCP Server 入口和定时任务（背景 §3.5、§3.6）的主体不是全局 owner，同样只能用只读工具。确有需要时，用 `tools` 按工具放宽（如 `create_issue: trusted`）；DSL 不能写「owner 或某个协议客户端」这样跨类别的 OR，这一点不在本 ADR 范围内。
- 迁移说明 `docs/migrations/mcp-tool-permit.md`（及英文版）给出：如何查看每个服务器被收紧了哪些工具（`zhin status`、Console）、三种常见写法（全部给主人、按工具放宽、恢复旧行为），以及恢复旧行为的风险。
- changeset 在 P1 里写明行为变更，并在 `version-policy.json` 记录所有者 2026-11-17 的批准。

## 验收标准

1. 一个服务器有 `list_issues`（标注只读）和 `create_issue`（未标注）：不写 `permit` 时，普通成员的回合里只有 `list_issues`，全局 owner 两个都有；会话层 owner 只有 `list_issues`。
2. 普通成员的会话里重放一次 `create_issue` 调用：被拒绝，trace 里是 `tool_denied`，`policy: 'mcp-permit'`。
3. `tools: { create_*: deny }` 后，全局 owner 也看不到 `create_issue`；`discover` 搜不到它。
4. Agent 层写 `default: everyone` 不能让普通成员看到服务器级只给主人的工具。
5. `zhin status` 显示「所有人可用 1 个 / 仅主人 1 个」；Console MCP 页与之一致。
6. owner 创建的定时任务点名 `create_issue`：任务状态为 `degraded`，trace 里有 `mcp_permit_withheld`；把规则改成 `create_issue: trusted` 后任务正常执行（仍经审批）。
7. 上游把 `create_issue` 标成 `readOnlyHint: true`：它对所有人可见，但调用仍要审批；管理员写 `create_issue: owner@global` 后收回。
