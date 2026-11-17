---
title: 升级：MCP 工具按聊天角色授权
description: ADR 0065 升级说明——已绑定的 MCP 服务器升级后收紧：上游标注只读的工具所有人可用，其余只给全局主人；permit 的三种常见写法与恢复旧行为的风险
---

# 升级：MCP 工具按聊天角色授权（ADR 0065）

本版本起，`ai.mcpServers` 接入的 MCP 工具和插件工具走同一套聊天角色授权（[ADR 0065](../adr/0065-mcp-tool-permit.md)，角色见[聊天角色](../concepts/chat-roles.md)）。

## 升级后会发生什么

**这是行为变更。** 已经绑给聊天 Agent（`ai.agents.<name>.mcpServers`）的 MCP 服务器，升级后立刻按新默认值收紧：

| 工具 | 升级前 | 升级后（不写 `permit`） |
| --- | --- | --- |
| 上游标注 `readOnlyHint: true` 的工具 | 所有人可见 | 所有人可见 |
| 没有标注、标注为写（`readOnlyHint: false`），或同时标了 `destructiveHint: true` 的工具 | 所有人可见，执行前审批 | 只有全局主人（`owner@global`）可见 |

- 普通成员、`trusted`、`admin` 以及只在某个账号或会话里是 `owner` 的人，只能看到上游标注只读的工具。看不到的工具不在模型的工具列表里，`discover` / `load_tool` 也找不到，`deferredTools.alwaysLoadedTools` 写了也不会常驻。
- 每次调用前按角色存储里的**当前**角色再判一次：会话历史里重放的旧调用、回合中被撤销的角色、子 Agent 沿用的父回合工具都会被拒绝，trace 里记为 `tool_denied`，`policy: mcp-permit`。
- 上游标注只决定谁能用，**不放宽审批**：MCP 工具仍按「可能写」处理，执行前照常走审批、文件策略、网络白名单和危险工具硬闸。
- 多数官方 MCP 服务器（如 GitHub、文件系统）已经给读工具标了 `readOnlyHint`；没有标注的服务器，普通成员升级后会看不到它的任何工具。

下面这些入口的回合主体不是全局主人，同样只能用只读工具：

- **定时任务**：到期时按创建者当前的角色重算，再降一档运行（`owner` → `trusted`，`trusted` / `admin` → `user`）。所以**全局主人创建的任务默认也用不了「仅主人」的 MCP 工具**；任务的执行计划点名了这样的工具时，该工具会缺失，任务记为 `degraded`。
- **A2A**（含跨进程 Mailbox 的远端信件，无论对端声明什么信任级别）与 zhin 自己的 **MCP Server** 入口（主体角色是 `user` / `authenticated`）。

## 查看收紧了哪些工具

- `zhin trace last`（或 `zhin trace <回合 id>`）：被拒绝的调用记为 `tool_denied`，策略 `mcp-permit`。
- 按服务器统计「所有人可用 / 仅主人」的计数会在后续版本出现在 `zhin status` 与 Console 的 MCP 页（ADR 0065 P2）。在此之前，可以对照上游服务器的 `tools/list` 结果里各工具的 `annotations.readOnlyHint`。

## 三种常见写法

`permit` 写在 `ai.mcpServers` 的每一项下，三个键都可以省略：

```yaml
ai:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ['-y', '@modelcontextprotocol/server-github']
      permit:
        readOnly: everyone        # 上游标注只读、且没被 tools 命中的工具；缺省 everyone
        default: owner@global     # 其余工具；缺省 owner@global
        tools: {}                 # 按上游工具名覆盖；缺省 {}
```

**1. 全部给主人（默认值，不用写）**：普通成员只用只读工具，主人全量。不信任某个服务器的标注时，把只读工具也收回给主人：

```yaml
      permit:
        readOnly: owner@global
```

**2. 按工具放宽或收紧**：`tools` 的键是上游报告的原始工具名（不带服务器前缀，区分大小写），值是一个档位。

```yaml
      permit:
        tools:
          create_issue: trusted                       # 放宽：trusted 成员和定时任务也能用
          merge_pull_request: [owner@global, private(*)]  # 只在主人私聊里可用（数组各项都要满足）
          delete_*: deny                              # 谁都不能用
```

- 档位写法：`everyone`（所有人）、`deny`（谁都不能用）、一个 permit 字符串（`trusted`、`admin`、`owner@global`、`role(owner@global,admin@adapter)`、`platform:admin` 等，与插件工具的 `permissions` 一项相同），或这样的字符串数组（各项都要满足）。`everyone` / `deny` 只能单独写，不能放进数组；空数组是配置错误。
- 匹配规则：精确名优先；没有精确名时，取字面字符最多的 `*` 模式（`create_*` 比 `*_issue` 多一个字面字符，所以优先）；字面字符一样多的几个模式都要满足。名字里含非 ASCII 字符的工具只能被精确名命中。
- `*` 会匹配上游以后新增的工具：放宽时尽量写精确名，收紧（`deny`、`owner@global`）时再用通配。
- 只放行列出的工具（白名单）：同时写 `default: deny` 和 `readOnly: deny`，再在 `tools` 里列出要开放的工具。

某个 Agent 还可以在自己的绑定里再收窄一层（与服务器级取 AND，只能收窄，省略的键不额外限制）：

```yaml
ai:
  agents:
    helper:
      mcpServers:
        - name: github
          permit:
            default: deny
            tools:
              get_me: everyone
```

**3. 恢复旧行为（不推荐）**：

```yaml
      permit:
        default: everyone
```

风险：所有人都能看到并调用这个服务器的写工具。`ai.agent.execApprovalMode` 的默认值是 `auto`，审批交给自动审核，普通成员发起的写操作通过自动审核后就会执行。确实需要时，优先用写法 2 只放开具体工具。

## 配置写错会怎样

`permit` 下出现 `readOnly` / `default` / `tools` 以外的键、数组为空、`everyone` / `deny` 放进数组、permit 字符串写错（包括已移除的 `master`、`scene_admin` 等，报错会给出替代写法）、同一层重复的模式、同一个 Agent 里重复列出同一个服务器，启动时都会报错，不会把工具多放出去。
