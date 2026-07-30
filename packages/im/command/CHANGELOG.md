# @zhin.js/command

## 1.0.4

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.0.3

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 50497a5: CommandContext session fields are structured objects (scene/sender) and TInput is constrained to CommandMessage.
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
- fa66c4c: Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
  expose unmatched structured segments through CommandContext. Preserve structured command input
  while stripping adapter command prefixes in the Core message dispatcher.
- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
