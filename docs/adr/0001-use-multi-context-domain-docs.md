# 使用多上下文领域文档

Zhin 是包含多个边界词汇的 monorepo，而不是只有一个统一产品域；如果只放一个根 `CONTEXT.md`，会模糊 Core IM、Agent、Queue、Console 等边界。我们使用根 `CONTEXT-MAP.md` 列出上下文，并把局部 `CONTEXT.md` 放在对应包或架构区域附近，让人和 Agent 都能读取与当前修改代码匹配的词汇。

