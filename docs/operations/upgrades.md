---
title: 版本兼容与迁移
---

# 升级 Zhin，而不是覆盖一个版本号

升级同时改变包图、Feature API、配置、持久数据和运行时 generation。安全流程必须先生成计划，再备份权威状态，最后用真实运行事实验收。

## 兼容边界

| 边界 | 兼容依据 |
| --- | --- |
| Node | `^20.19.0 || >=22.12.0` |
| Root 与插件 | `package.json#zhin.engine` 的 semver |
| Feature consumer/provider | `features[].api` 与 Feature `featureApi` |
| Zhin 包族 | lockfile 中解析出的同一发布组合 |
| Console | Host 公开 REST/RPC/SSE 契约与公开 client 类型 |
| 持久数据 | 对应版本的 Schema、Journal 与迁移说明 |

生产环境提交 lockfile，不使用漂移的 `latest` 解析结果启动。`zhin migrate` 会把非 workspace 的 Zhin 依赖目标更新到 `latest`，因此它是显式升级动作，不是每次部署命令。

## 升级前

```bash
zhin migrate --dry-run
zhin doctor
```

阅读根 Changesets/CHANGELOG 与涉及包的发布说明。特别检查 breaking manifest、Feature API、配置删除、数据库迁移和 Adapter 接入方式。

创建同一检查点：Git commit、`package.json`、lockfile、配置、`.env` 键名清单、数据库快照、Workroom store 与 `data/schedule-jobs.json`。密钥值单独由 Secret manager 保护。

## 执行升级

1. 在副本或预发布环境运行 `zhin migrate --dry-run`。
2. 进入维护窗口，停止会产生新副作用的入口。
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
