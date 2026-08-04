---
"@zhin.js/agent": patch
---

fix(agent): subagent 延迟加载工具执行报 "Unknown tool" + 父会话 snapshot 污染

子 Agent / standalone loop 此前只有静态工具集：`load_tool` 报"加载成功"（写 snapshot）但 executor 找不到新加载的工具，模型反复重试空耗 token（实测 15 轮 77s 无法识别图片）。修复：

- standalone loop 接入与主 loop 相同的延迟加载机制：`load_tool` 命中后从 catalog 并入完整工具、重建 schema 并补全一轮（`refreshTools` + `shouldRecompleteAfterTool`）。
- deferred runtime 增加 AsyncLocalStorage 隔离通道：子 loop 的 snapshot 从父会话克隆（可见父已加载工具），但其 `load_tool` 变更只活在本 loop，不再写父会话 snapshot。
