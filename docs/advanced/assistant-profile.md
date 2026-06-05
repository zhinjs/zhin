# Assistant Profile（M5）

将 `SOUL.md`、`AGENTS.md`、`TOOLS.md`、默认 notify、heartbeat 巡检收敛到 **单文件 Profile**，与 Bootstrap 合并注入。

## 启用

```yaml
assistant:
  enabled: true
  profile:
    enabled: true
    file: assistant.profile.yml   # 默认文件名
```

启动日志：`profile: true`（与 `assistant_runtime` 同条）。

## 文件结构

```yaml
version: 1

persona:
  soul: |
    # 人格（等同 SOUL.md）

agents: |
  # 持久化指令与记忆（等同 AGENTS.md）

tools: |
  # 工具习惯（等同 TOOLS.md）

defaults:
  notify:
    channel: im
    platform: icqq
    botId: "8596238"
    sceneId: "1659488338"
    scope: private
  notifyOnFailure: false

routines:
  heartbeat:
    enabled: true
    everyMs: 1800000          # 30 分钟
    notify:
      channel: silent
```

## 合并规则

1. **Profile 优先**：`persona.soul` / `agents` / `tools` 有内容时，覆盖同名 markdown 文件。
2. **回退**：Profile 某段为空时，仍读项目根或 `data/` 下的 `SOUL.md` 等。
3. **HEARTBEAT**：`routines.heartbeat.enabled: true` 时写入 `assistant-jobs.json`（id: `assistant-profile-heartbeat`），并关闭 legacy Scheduler 内置 HEARTBEAT，避免双跑。

## 与三文件关系

| 传统 | Profile 字段 |
|------|----------------|
| SOUL.md | `persona.soul` |
| AGENTS.md | `agents` |
| TOOLS.md | `tools` |
| HEARTBEAT.md + Scheduler | `routines.heartbeat` |

无 Profile 时行为与 M4 之前完全一致（Stable 默认）。

## test-bot 示例

见 [examples/test-bot/assistant.profile.yml](https://github.com/zhinjs/zhin/blob/main/examples/test-bot/assistant.profile.yml)（**仅 routines / defaults / devices**；人格与工具习惯仍用 SOUL/AGENTS/TOOLS，避免与 `# Orchestration` 重复占 token）。

## 相关

- [Assistant Runtime 路线图](../architecture/assistant-runtime)
- [配置文件 — assistant](../essentials/configuration.md)
