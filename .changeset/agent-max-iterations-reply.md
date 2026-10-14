---
'@zhin.js/agent': patch
---

fix(agent): 工具步数用尽时不再把原始工具输出发给用户。循环结束且没有可见回复时，会关闭工具再请模型总结已完成的工作、剩余事项并询问是否继续；总结失败则回复固定提示。`formatToolCallsForUser` 不再展示 read_file / grep / glob / list_dir / web_fetch 等只读探索工具的结果，并限制总长度。
