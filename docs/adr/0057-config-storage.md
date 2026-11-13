---
sidebar: false
---

# ADR 0057：配置与状态存放——声明放 `zhin.config.yml`，运行时状态放数据库，密钥放 `.env`

状态：Accepted（2026-11-13）

关联：ADR 0049（Console 访问控制入库）、ADR 0050 / 0055（功能配置的全局 / 适配器 / 账号 / 会话四级）、ADR 0053（引导进度文件）、ADR 0054（管理网关与配置事务）、ADR 0056（聊天角色入库）。

## 背景

现在每类数据存在哪，是在各个 ADR 里逐个决定的，没有一条统一规则。盘点（2026-11-13）发现这些问题：

1. **功能配置分两处存**：全局、适配器、账号三级写在 `zhin.config.yml` 的 `plugins.<实例>.overrides` 里，会话级在数据库表 `feature_conversation_overrides` 里。群管理员在聊天里改适配器级、账号级设置时会直接改写 yml，yml 于是成了运行中反复改写的文件，和手改互相抢写。
2. **账号和模型目录有两个"真相"**：yml 里插件块的 `endpoints[]` 和项目里的 `ai.plan.yml` 只在第一次启动时导入数据库，之后以数据库为准；再改这两处会被悄悄忽略。
3. **密钥有三种存法**：
   - `.env` 加 `${VAR}` 引用；
   - 数据库密文，钥匙放在 `.zhin/inference/root-key.json`、`.zhin/endpoint-credentials/`；
   - 个别插件表直接存明文。

   此外 yml 里仍可以直接写明文 token。`.env` 的写入也不是原子操作。
4. **"永久批准"放在 `data/owner-approve-always.json`**：聊天角色在数据库，工具策略在 yml，永久批准又是第三处，都属于安全授权。
5. **备份不完整**：脚手架的 `.gitignore` 忽略 `.zhin/`。只备份数据库而不带 `.zhin/` 里的钥匙，就解不开账号和模型凭据。

## 决策

### 1. 判定规则

一条配置该放哪，看三件事：谁改、什么时候改、条目有多少。

| 存放处 | 放什么 | 判定 | 谁可以写 |
|---|---|---|---|
| `zhin.config.yml` | **声明**：部署时就定下来，要随代码进 git、经过评审，改了需要重载或重启 | 人在部署时改、条目数量固定 | 人：手改、CLI、Console 配置表单（都经网关配置事务，ADR 0054） |
| 数据库 | **运行时状态**：运行中由 Console、聊天或 AI 产生和修改 | 运行中改、条目随群和账号增长 | 运行时：Console RPC、聊天命令、AI 工具、插件 |
| `.env` | **密钥与环境差异** | 不能进 git、因环境而异 | 人、CLI（`zhin doctor --fix`）、网关 |
| `.zhin/` | **本机运行文件**：socket、锁、日志、缓存、引导进度；加密钥匙集中放在 `.zhin/keys/` | 可以丢弃（`keys/` 除外） | 运行时、网关 |

由此得到：

- **yml**：
  - 插件实例声明与插件配置（`plugins`、各实例配置块）、`disable_plugins`；
  - 主机基础设施（`http`、`database` 连接、`console`、`gateway`、`mcp`、`a2a`、`log_level`、`locale`）；
  - AI 行为与安全策略（`ai.*`，含 `toolHardGate`、`execAllowlist`）；
  - 功能的**全局默认值**、字段锁与自助开关（`features.selfService`）。
- **数据库**：Console 账号与审计、聊天角色、账号与凭据、模型目录、**适配器 / 账号 / 会话三级功能覆盖**、控制面开关、定时任务、消息 / 会话 / 记忆、插件状态、**永久批准**。
- **`.env`**：所有密钥。yml 里只写 `${VAR}` 引用。

### 2. 适配器 / 账号级功能覆盖迁入数据库

> 已实现（2026-11-13）。实现要点：
>
> - 表 `feature_overrides`：`id`（`sha256(plugin, level, key)`）、`plugin`、`level`、`key`、`enabled`、`patch`、`revision`、`updated_at`、`updated_by`。旧表 `feature_conversation_overrides` 的行在首次加载时以 `level = 'conversation'` 复制过来（新表已有该键的行或墓碑时跳过，可重复执行）；旧表保留、只读、不再写入，确认无误后可手动删除。
> - 有效配置解析（`configFor` / `isEnabledFor`、分发门禁、Agent 工具披露、Console `feature.*`）的适配器 / 账号级只读数据库，合并顺序、锁定与字段白名单不变；配置文件里遗留的 `overrides` 块不参与解析。
> - 迁移由实例在启动时完成（与聊天角色迁移同一做法，网关此时尚未接管写入）：配置解析前找出各插件块（含嵌套子插件块）的 `overrides`；数据库加载后逐条写入（已有行或墓碑时保留数据库的值），记录 `imported`；首个世代启动后先把配置文件备份到 `.zhin/backups/feature-overrides-<时间>/`，再经配置文档 `prepare` / `commit`（原子写，按启动前读到的修订号比对）删除这些块，记录 `done`。任何一步失败都不改配置文件，下次启动重试；值里含 `${…}` / `env://` 引用时直接停止启动（数据库里的覆盖不做环境变量展开）。
> - 修订（2026-11-13，合并后复审）：嵌套块只认候选世代插件树里的真实子插件实例（与配置合成器同一规则；插件树不可用时本次启动不导入）；键不合适配器 / 账号键格式、或层级写错的条目（以前不生效）跳过并警告，不导入、只留在备份里；`imported` 状态下配置文件的改动在数据库行仍为迁移所写（修订号 1、`updated_by` 为 `migration:…`）时覆盖该行，否则保留数据库值并逐条警告。
> - `done` 之后（以及从未写过 `overrides` 的项目），启动时与每次配置更新时出现 `overrides` 都被拒绝，提示改用 Console 功能页或「功能 设置」聊天命令，见 `docs/migrations/feature-overrides.md`。
> - 非关系型方言下写入被拒绝（503 `feature-overrides-unpersisted`），会话级也一样；首次迁移的条目只在内存中生效，配置文件不动、迁移记录保持 `pending`，直到换用关系型数据库。
> - `feature.*` 请求与响应形状不变；适配器 / 账号级的 `revision` 改为该行的修订号，兼容旧版 Console：适配器 / 账号级仍接受等于当前配置修订号的 `expectedRevision`（不做行级检查）。

- `feature_conversation_overrides` 扩展为通用的 `feature_overrides` 表，新增 `level` 列（`adapter` / `endpoint` / `conversation`）。主键按 `(plugin, level, key)` 生成；`enabled`、`patch`、`revision`、`updated_at`、`updated_by` 语义不变。现有会话行迁移时写入 `level = 'conversation'`。
- **全局级仍在 yml**：插件配置块本身就是全局默认，`disable_plugins` 管全局启停。
- 锁的规则不变（ADR 0055）：上级停用会锁住下级，字段白名单仍由插件 Schema 声明。
- **迁移**：
  1. 首次启动时，把 yml 中各实例的 `overrides.adapters` / `overrides.endpoints` 导入数据库；
  2. 导入成功后，经网关配置事务从 yml 删除 `overrides` 块；
  3. 原文件备份到 `.zhin/backups/`。

  迁移记录写在 `.zhin/migrations/feature-overrides.json`，做法与聊天角色迁移相同（ADR 0056）。
- 迁移完成后，yml 里再出现 `overrides` 会被拒绝，错误信息提示改用 Console 或聊天命令。
- 改动即时生效，不需要重启。多实例共用数据库时，沿用会话级的刷新节奏（最多 5 秒）。
- 数据库方言不支持关系持久化（mongo / redis / memory）时，拒绝写入，并说明原因（同 ADR 0056）。

### 3. 种子导入后从 yml 移除，Console 支持导出

账号（插件块里的 `endpoints[]`）和模型目录（`ai.plan.yml`）只用来做第一次导入：

- **导入**：首次启动、数据库里还没有对应记录时导入。成功后，经网关配置事务从 yml 删除 `endpoints[]`；`ai.plan.yml` 移到 `.zhin/backups/`。导入结果写入迁移记录。
- **再次出现**：已导入的项目里，yml 中又出现 `endpoints[]` 或 `ai.plan.yml` 时，启动日志与 `zhin doctor` 报告"已忽略，数据库为准"，并给出 Console 的对应页面。不会悄悄忽略。
- **导出**：Console 在账号页和模型管理页提供"导出"，生成与种子同格式的文件（`endpoints[]` 片段、`ai.plan.yml`）。用途是迁移到新项目，或在全新项目里作为种子导入。
  - 导出**默认不含凭据**（2026-11-13 确认）：凭据位置写成 `${VAR}` 占位，并附上需要在新环境 `.env` 中补齐的变量清单。导出文件即使外泄也不暴露凭据；换环境时需要重新填写。
  - 导出对应一个网关 RPC，权限为 `endpoint.manage` / `agent.configure`，并写入审计日志。

### 4. yml 里的明文密钥：启动警告，`zhin doctor --fix` 搬到 `.env`

- **怎么识别密钥字段**：主机 Schema 与插件 Schema 用 `x-zhin-secret: true` 标注；没有标注时，按字段名（`token`、`password`、`secret`、`apiKey`、`privateKey`）兜底。
- **启动时**：发现字面值（不是 `${…}` 引用）会给出警告，列出路径但不打印值。
- **`zhin doctor --fix`**：
  1. 把字面值写入 `.env`（变量名 `ZHIN_<路径大写下划线>`，重名时追加序号）；
  2. 把 yml 中的值替换为 `${变量名}`；
  3. 两个文件都原子写入。
- **`.env` 的写入改为原子写**：与 yml 一样，用临时文件加 rename，并保留文件权限与锁。
- **插件规则**：插件存凭据必须使用宿主的加密凭据存储（`host-credential-storage`），不得自建明文表。现有明文表（如 `music_credentials`）列为后续迁移项。

### 5. 永久批准迁入数据库

- `data/owner-approve-always.json` 迁入表 `agent_owner_approvals`。每条记录包括：主体、范围（工具或类别）、授予人、授予时间、撤销时间。
- 首次启动时导入，导入后原文件改名为 `.imported`。
- 撤销写入撤销时间而不删除记录，留作审计。Console 后续提供查看与撤销入口。
- `data/` 目录里的其他内容（记忆文件、trace、资源、迁移计划）不在本 ADR 范围内。

### 6. 钥匙集中存放，新增 `zhin backup`

- 加密钥匙集中到 `.zhin/keys/`：`inference/root-key.json` 迁到 `keys/inference.json`，`endpoint-credentials/` 迁到 `keys/endpoint-credentials/`。启动时一次性搬移，旧路径仍可读一个版本周期。
- 新增 `zhin backup [--out <file>] [--include-env]`，生成 `0600` 权限的 `tar.gz`，内容包括：
  - `zhin.config.yml`、`package.json`、`schema.json`；
  - `.zhin/keys/`；
  - 数据库：sqlite 用在线备份 API 拷贝，mysql / pg 提示改用 `mysqldump` / `pg_dump`，并在包内写明需要一并恢复。
  - 默认不含 `.env`，用 `--include-env` 才包含，并给出警告。
- 网关运行时，备份经网关进行，保证数据一致。配套的 `zhin restore` 放到后续再做。
- 文档写明：**数据库备份必须和 `.zhin/keys/` 一起保存**，否则无法解密凭据。

### 7. 写入通道

- yml 的写入一律经网关配置事务（ADR 0054）：记录修订号、原子写、失败回滚。
- 聊天和 AI 只写数据库；全局开关和插件配置这类 yml 内容，从聊天发起时同样经网关事务。
- 现有 yml 写入入口逐项对齐：
  - Console `plugin:set-enabled` 与 `feature.set-enabled` 的全局级，已改走网关，权限为 `plugin.manage`。
  - 聊天"功能 开启/关闭"的全局级，以及聊天 `config set` / AI `config_patch`，留作待定项。

## 待定

- **聊天 `config set` 与 AI `config_patch` 怎么处理**：
  - 它们改的是插件配置，属于 yml 声明。
  - 两个方案：改为经网关事务，并限 `owner@global` 才能用；或者直接移除，只保留 Console 和 CLI。
- **控制面开关的实例默认值**（`emergency_stop`、`muted`）：现在在数据库，按规则属于运行时状态，保持不变。如果希望在部署时预设，可以在 yml 里加一个初始值，只在首次启动时导入。
- **插件自建的每群设置表**（如 `roulette_group_settings`）与通用的会话级覆盖重叠：建议插件改用 `feature_overrides`，逐个评估。

## 实施顺序

每一步单独开 PR：

1. **规则落地**：
   - 本 ADR 与 `docs/configuration/index.md` 的"文件与数据库记录各管什么"重写；
   - Schema 增加 `x-zhin-secret` 标注；
   - 明文密钥启动警告，`zhin doctor --fix` 搬到 `.env`；
   - `.env` 改为原子写。
2. **功能覆盖迁移**（已完成）：`feature_overrides` 表、导入并从 yml 删除、Console 与聊天写入路径改到数据库、拒绝 yml 里的 `overrides`。
3. **种子移除与导出**：`endpoints[]`、`ai.plan.yml` 导入后移除，Console 导出（含网关 RPC 与审计）。
4. **永久批准入库**。
5. **钥匙集中**与 `zhin backup`。

## 修订 2026-11-13：Console 账号不在数据库里（ADR 0059）

- §1「数据库：Console 账号与审计…」改为：Console 账号、角色、会话、API 令牌与审计放在网关的 `.zhin/gateway.db`（[ADR 0059](./0059-gateway-storage-isolation.md)），不在项目数据库；`.zhin/` 表格行的「可以丢弃（`keys/` 除外）」相应改为「`keys/` 与 `gateway.db` 除外」。
- §4 密钥规则同样适用于 PostgreSQL / MySQL 的 Console 受限账号：`database.console.password` 写 `${ZHIN_DB_CONSOLE_PASSWORD}`，值只在 `.env`（`zhin db console-role` 写入）。
- §6 `zhin backup` 实现时必须包含 `.zhin/gateway.db`（SQLite 在线备份），所有方言都要：`pg_dump` / `mysqldump` 不再含账号。文档写明 `.zhin/` 必须持久化。

