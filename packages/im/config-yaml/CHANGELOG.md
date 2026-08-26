# @zhin.js/config-yaml

## 1.0.18

### Patch Changes

- Updated dependencies [fcbff21]
  - @zhin.js/runtime@1.0.18

## 1.0.17

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/runtime@1.0.17

## 1.0.16

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/runtime@1.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [45d4f24]
  - @zhin.js/runtime@1.0.15

## 1.0.14

### Patch Changes

- Updated dependencies [2719580]
- Updated dependencies [c92286c]
  - @zhin.js/runtime@1.0.14

## 1.0.13

### Patch Changes

- Updated dependencies [67ef8c4]
- Updated dependencies [985fa22]
  - @zhin.js/runtime@1.0.13

## 1.0.12

### Patch Changes

- @zhin.js/runtime@1.0.12

## 1.0.11

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/runtime@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [953cfe1]
  - @zhin.js/runtime@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [daffd4c]
  - @zhin.js/runtime@1.0.9

## 1.0.8

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/runtime@1.0.8

## 1.0.7

### Patch Changes

- @zhin.js/runtime@1.0.7

## 1.0.6

### Patch Changes

- @zhin.js/runtime@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/runtime@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/runtime@1.0.4

## 1.0.3

### Patch Changes

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [078e3f7]
- Updated dependencies [43485a9]
- Updated dependencies [8c7d03d]
- Updated dependencies [fa66c4c]
  - @zhin.js/runtime@1.0.3

## 1.0.2

### Patch Changes

- @zhin.js/runtime@1.0.2

## 1.0.1

### Patch Changes

- @zhin.js/runtime@1.0.1
