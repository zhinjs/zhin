# 目标结构草图

这是一个常见的重构目标结构，不是强制模板。

```text
src/
  index.ts
  commands/
    index.ts
  middlewares/
    index.ts
  events/
    index.ts
  crons/
    index.ts
  tools/
    index.ts
  services/
    database.ts
    http.ts
    domain.ts
  models/
    index.ts
client/
  index.tsx
  pages/
  components/
```

## 最小保留原则

- 没有这类能力，就不要建这类目录
- `index.ts` 只负责装配
- 先把重复逻辑抽到 `services/`，再考虑更细分层

## 常见收缩版

如果插件没有前端、AI 工具、定时任务，可以收缩为：

```text
src/
  index.ts
  commands/
  services/
  models/
```

如果插件只有少量命令和一个服务，也可以只保留：

```text
src/
  index.ts
  services/
```