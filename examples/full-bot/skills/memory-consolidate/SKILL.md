---
name: memory-consolidate
description: 回合末或 master 说「记住」时，将 1–3 条可检索事实写入 memory_entries（memory_upsert），文件 MEMORY.md 仅保留纲领。
tools:
  - memory_upsert
  - memory_search
---

# memory-consolidate

## 何时触发

- 用户明确要求「记住 / 记下来」
- 编排 run 完成且有关键结论需长期保留
- 回合末发现新的**稳定事实**（非临时状态）

## 执行规则

1. 先 `memory_search` 查重，避免重复写入同 key。
2. 用 `memory_upsert` 写入 1–3 条，每条：
   - `key`：稳定标识，如 `capability:hard_orchestration_v1`、`preference:language`
   - `content`：一句可检索事实（≤200 字）
   - `scope`：默认 `global`；会话专属用 `session`
   - `source`：`skill:memory-consolidate`
3. **不要**把长文塞进 `data/memory/global/MEMORY.md`；纲领性架构说明才写文件层。

## 示例

```
memory_upsert(
  key="capability:hard_orchestration_v1",
  content="shipped",
  scope="global",
  tags=["l4","orchestration"]
)
```
