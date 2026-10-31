---
title: "版本兼容与迁移"
description: "安全升级 Zhin：兼容边界、升级前准备、执行步骤、何时回滚，以及插件作者的版本责任"
---

# 升级 Zhin，而不是覆盖一个版本号

升级同时改变依赖包、Feature API、配置、持久数据和运行中的插件版本。安全的流程是：**先预演，再备份，最后用实际运行结果验收**。

日常的补丁升级通常只需要：

```bash
npx zhin migrate --dry-run   # 先看会改什么
npx zhin migrate             # 执行升级
npx zhin doctor && pnpm test # 检查
npx zhin runtime start --once --mode test  # 装配冒烟
```

生产环境请按下文完整流程执行，并在升级前做好备份。升级前先停止 Bot，避免依赖目录在运行中被替换。

## Adapter API 2：本批 patch 的插件边界 {#adapter-api-2}

本批是包含插件接口变更的 patch，不能仅凭 `1.1.x` 判断兼容。下表是首批目标版本，尚未
执行发布；安装前应核对正式发布清单，并将整组依赖和 lockfile 一起升级。

| 包／契约 | 旧接口最后支持版本 | 新接口最低版本 |
| --- | --- | --- |
| `zhin.js` | `1.1.18` | `1.1.19` |
| `@zhin.js/core` | `1.1.53` | `1.1.54` |
| `@zhin.js/adapter` | `1.1.25`，Feature API `1.0.0` | `1.1.26`，Feature API `2.0.0` |
| `@zhin.js/feature-kit` | `1.1.9` | `1.1.10` |
| Runtime / Isolate | `1.1.15` | `1.1.16` |
| Plugin Runtime / Agent | `1.1.17` / `1.1.44` | `1.1.18` / `1.1.45` |
| 19 个普通官方平台适配器包 | 各包 `1.1.18` | 各包 `1.1.19` |
| Bilibili / Bilibili-live 适配器 | 各包 `0.1.1` | 各包 `0.1.2` |
| Sandbox 适配器 | `1.1.20` | `1.1.21` |

新适配器在 `zhin.features` 中声明 `{ "package": "@zhin.js/adapter", "api": "^2.0.0" }`。
这是现有 Feature API 校验：旧的显式 `^1.0.0` 在 API-2 Provider 上被拒绝，新的 `^2.0.0`
在 API-1 Provider 上被拒绝。`zhin.engine` 仍是独立的 `^1.0.0` 契约，不是上述 npm 版本。
历史包若省略 `api`，框架不新增默认拒绝；这种声明不足以证明它兼容，需作者与管理员
检查真实依赖、旧接口使用和锁文件。无法为旧 npm 包追溯修改其宽泛的 peer 范围。

自定义适配器需重新发布：使用 `createAdapter`、真实 Client 继承及 `endpointSpec`；只在
`@zhin.js/feature-kit` 增补 `AdapterRegistry` 并直接声明 peer/dev 依赖；控制与群管方法改为
命名请求对象。Host 的撤回／编辑／回应／typing 使用完整 canonical 消息或会话引用，
不再额外传重复账号选择器。不要修改第三方 SDK 的原生签名。Satori、OneBot12 配置补齐
`platform + userId`，企业微信补齐真实 `agentId`。详细接口见[适配器开发](../authoring/adapters.md)。

升级时先在数据副本预演并备份旧 lockfile、账号身份与加密密钥材料、数据库、插件状态、
Owner 审批文件及已有迁移计划／journal。历史别名记录不会自动猜测新账号、频道父级或
话题；使用已认证的 `/api/data-migrations` 先预览、选择完整目标并准备计划，再显式 apply。
apply 后保持 maintenance 暂停，核对后单独 resume；不自动重发通知、延长游戏截止时间或
恢复权限。超时或断线后先 reconcile，不能根据缺少回执判断未提交并重试。

Owner 审批 V2 保留为不生效的历史授权，新审批写入 V3。旧代码不能读取 V3：回退要同时
恢复对应代码、lockfile 和已验证的旧数据，不是只降 npm 版本。数据 restore 只接受未变化的
after-image；若已有新业务写入，先处理冲突，不覆盖它们。保留迁移计划和 domain journal；
历史权限必须重新授权。此版本说明不代替真实账号操作、发布、部署或生产数据迁移的确认。

## 从 1.1.13 及更早版本升级：configVersion 2 {#configversion-2}

::: warning 破坏性配置变更
`@zhin.js/cli` 1.1.14 起，Runtime 只接受 `configVersion: 2`（扁平插件配置）。`^1.1.x` 项目自动升级依赖后，旧配置会被直接拒绝启动，报错包含 `configVersion must be 2`；新版 CLI 会直接提示“检测到 v1 配置”。按以下顺序迁移，不要跳步。
:::

1. **先停止 Bot，再升级依赖。** pnpm 升级时会删除旧版本目录，仍在运行的进程会在升级中途崩溃或加载半新半旧的文件。

   ```bash
   zhin stop   # 前台、systemd、pm2、launchd 托管的进程也要先停
   ```

2. **升级到带迁移命令的 CLI（1.1.14 及以上）。** 1.1.13 及更早的 `zhin migrate` 只升级依赖和 scripts，没有 `instances` 子命令。

   ```bash
   pnpm add zhin.js@latest @zhin.js/cli@latest
   pnpm install
   ```

   旧版 `zhin migrate` 会把精确锁定的版本也改成 `latest`，请先用 `--dry-run` 核对；新版默认保留锁定版本。

3. **预览配置迁移**（不写文件，不打印配置值）：

   ```bash
   zhin migrate instances
   ```

4. **应用迁移**（写入前自动备份）：

   ```bash
   zhin migrate instances --apply
   ```

   原文件备份在 `.zhin/instance-declarations-migration/`；新版 CLI 还会复制一份到 `.zhin/backups/config-v2-<时间戳>/` 并打印路径。

5. **检查并重新启动**：

   ```bash
   zhin config check
   zhin doctor
   pnpm start
   ```

**恢复**：保持 Bot 停止，运行 `zhin migrate instances --recover rollback`；或按备份目录中 `manifest.json` 列出的路径把文件复制回去，再删除 `.zhin/instance-declarations-migration`。迁移中断时用 `--recover continue` 继续。如果要退回旧版本运行，还要把依赖和 lockfile 一起恢复到 1.1.13。

工具拒绝自动转换的情况（嵌套插件、逐挂载 optional、实例名与保留键碰撞）见[迁移到扁平插件配置](../migrations/plugin-instance-declarations.md)。

## 兼容边界

| 边界 | 兼容依据 |
| --- | --- |
| Node | `>=22.19.0` |
| Root 与插件 | `package.json#zhin.engine` 的 semver |
| Feature consumer/provider | `features[].api` 与 Feature `featureApi` |
| Zhin 包族 | lockfile 中解析出的同一发布组合 |
| Console | Host 公开 REST/RPC/SSE 契约与公开 client 类型 |
| 持久数据 | 对应版本的 Schema、Journal 与迁移说明 |

生产环境提交 lockfile，不使用漂移的 `latest` 解析结果启动。`zhin migrate` 会把非 workspace 的 Zhin 依赖目标更新到 `latest`，因此它是显式升级动作，不是每次部署命令。

显式 `workspace:` 依赖始终保留，包括从工作区子包运行升级时；当前目录缺少 `pnpm-workspace.yaml` 也不会将本地链接改成注册表依赖。工作区解析失败应检查工作区声明及包名，而不是让升级命令更换依赖来源。

`migrate` 默认执行依赖安装，只有 `--no-install` 才跳过。pnpm 安装会更新锁文件以匹配迁移后的清单（`--no-frozen-lockfile`，包括 CI 环境）。如果当前目录只有 npm 锁文件却声明了 `workspace:` 依赖，命令会在修改文件前停止：npm 无法安装该协议。请先确认 pnpm 工作区配置，或明确使用 `--no-install` 仅迁移清单，再自行处理依赖安装。

## 升级前

```bash
zhin migrate --dry-run
zhin doctor
```

阅读根 Changesets/CHANGELOG 与涉及包的发布说明。特别检查 breaking manifest、Feature API、配置删除、数据库迁移和 Adapter 接入方式。

创建同一检查点：Git commit、`package.json`、lockfile、配置、`.env` 键名清单、数据库快照、Workroom store 与 `data/schedule-jobs.json`。密钥值单独由 Secret manager 保护。

## 执行升级

1. 在副本或预发布环境运行 `zhin migrate --dry-run`。
2. 进入维护窗口，停止 Bot 和会产生新副作用的入口（必须在升级依赖之前）。
3. 执行 `zhin migrate`，审阅 package、scripts 与目录变化。
4. 运行 `zhin doctor`、类型检查、测试和 `runtime start --once --mode test`。
5. 启动生产，完成 Sandbox、真实 Endpoint、Agent 与 Workroom 验收。

不要在运行中的实例之间共享一份可写 SQLite 或文件 Journal。蓝绿发布需要独立副本和明确切换点；只有一个实例能拥有写 authority。

## 回滚判定

以下任一情况应停止发布：候选 generation 不能发布、Endpoint 无法恢复、SSE history 出现无法重建的 gap、Workroom authority 校验失败，或数据迁移没有逆向方案。

回滚时恢复完整检查点。若已产生外部消息、审批、Git 操作或支付类副作用，数据恢复不能撤销现实世界；必须通过幂等键、Effect Ledger 或人工补偿处理。

## 插件作者的版本责任

- breaking 公共 API 使用 major changeset。
- 新 Feature API 同步更新 provider、consumer 要求与 API surface 快照。
- 删除配置时提供明确拒绝和迁移目标，不保留静默双轨。
- 发布前安装真实 tarball，验证 JS entry、`files`、peer dependency 与 README。

生产部署与备份见[生产部署与运维](./production)。
