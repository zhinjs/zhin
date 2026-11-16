---
"@zhin.js/harness": minor
"@zhin.js/agent": patch
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/cli": patch
---

协作 id 跨重启唯一，并修复 `zhin trace --engagements` 读错数据库（#1250 第 35 批）。

- `engagement-id-reused-across-restarts`：Engagement、信件与预算授权 id 原先是每次启动从头计数的 `m1`、`m2`……（授权 `g1`……），重启后重复，一个 `engagement_events` id 下混进几次重启里互不相干的协作（Workroom `?engagementId=m17`、`zhin trace --engagements` 都会混在一起）。现在 id 形如 `m-<运行 id>-<序号>` / `g-<运行 id>-<序号>`：运行 id 在每次实例启动时由启动时间（base36）加随机字符生成，Agent 的 Harness 与预算账本共用同一个运行 id。id 对 Console 协议、Workroom 与 CLI 仍是不透明字符串，格式没有对外约定。`@zhin.js/harness` 新增 `createRunId`、`createRunScopedIdFactory`、`isLegacyCounterId`，`createHarness` / `InMemoryBudgetLedger` 未传 `newId` / `idFactory` 时也改用运行 id。
- 一次性数据迁移：新增 `migrateEngagementEventIds`（标记表 `engagement_event_migrations`），实例启动后在后台（以及 `zhin trace --engagements` 打开数据库时）把同一个旧 id 下的记录按 `seq` 顺序、在每条 `engagement_opened` 处拆成各自的 Engagement，换上新 id，并改写记录里的信件 id（`mailId`、`rootMailId`、`causationId`、`mails` 等）、授权 id（`grantId`、`rootGrantId`、`parentId`）以及协作之间的 `carriedBy` 引用。分批执行，每批一个事务、按主键读写：读者看到的每个旧 id 要么完整未拆、要么已全部拆完；每批核对行数，不丢行；中途停止或崩溃时已提交的批次保留，下次启动接着做；全部完成后写标记，之后再运行是空操作。迁移不阻塞实例启动（大表在远程数据库上可能超过网关的就绪超时），进行中协作日志照常读写。只含一次协作的旧 id 不变。支持 SQLite、MySQL、PostgreSQL（与协作事件日志相同）；失败只记日志，下次启动重试。Console SQL 不能写这张标记表。
- `trace-engagements-crash` 复测：1.5.0（2cf215e0）里 CLI 仍把数据库 Host 直接交给日志，修复在第 21 批（a460a46f0）才合入、晚于 1.5.0，当前版本已不再报 `this[#db].select is not a function`。另外修复 `zhin trace --engagements --cwd <dir>`（以及 `zhin usage report` 的服务名查找）把相对的 SQLite 路径按当前目录解析、打开一个新的空库的问题：现在按项目根目录解析，与网关一致。`zhin trace --engagements <id>` 优先精确匹配，再按前缀匹配。
- 文档（第 33 批的无人值守自动审核）：`execApprovalMode` 默认就是 `auto`，所以定时任务等无人值守回合里需要审批的工具默认交给审核 Agent 判断；不想要时设 `ai.agent.execApprovalMode: ask`（人工审批），无人值守时这些调用直接拒绝（没有只关掉无人值守审核的单独开关）。只要 `confirmHighRisk` 保持默认的 `external_content`，任何模式下读取外部内容之后的高危动作在无人值守时一律拒绝，审核 Agent 也不能放行。`docs/ai/index.md` 示例里把默认值误写成 `ask`，已改正。
