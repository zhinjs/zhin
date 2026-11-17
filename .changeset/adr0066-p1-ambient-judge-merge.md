---
"@zhin.js/ai": minor
"@zhin.js/agent": minor
"@zhin.js/cli": minor
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"zhin.js": patch
---

「旁听」用途和决策「旁听参与判断」合成一项「插话判断」`purposes.ambient`，旧配置自动迁移（ADR 0066 P1，行为变更）。

- 新的配置形状 `purposes.ambient: { profile, fallbacks, compare, minConfidence, mode, timeoutMs }`：主判断与备用链可以混排语言模型和决策模型（判断器按 Profile 的模型类型分派），`compare` 是只记录的对照模型，`minConfidence`（默认 0.7）是唯一的门槛，`mode: shadow` 是唯一的「只记录不插话」，`timeoutMs` 是决策模型成员的单次超时。字符串写法 `ambient: <profile>` 仍然有效；写入总是整项替换，`null` 清除。没写 `profile` 时继承部署聊天的主项和备用链（此时不能单独写 `fallbacks`）。只允许这 6 个键，Profile 必须存在、属于 Host、不能是图像模型，链内不能重复、不能包含 `profile`，`compare` 不能在链内；错误带路径（如 `purposes.ambient.fallbacks[1]`）。
- **行为变化**：旧配置在 Host 加载模型配置时自动迁移一次（一个 CAS 事务，同时写迁移记录，`before` 保存迁移前完整的 `purposes`）。原来决策「启用」并单独配置了旁听语言模型的部署，该语言模型成为第一个备用：决策模型超时、网络错误、5xx、回答无效或配额用完时由它接手插话（以前直接不插话）。门槛取原来两道门槛中较大的值，插话不会因此变多。决策「仅评估」迁移为对照模型，主判断与插话行为不变；决策「关闭」的 Profile 不迁移。`zhin.config.yml` 的 `ai.trigger.ambient.minConfidence` / `mode` 在迁移时读入一次，之后不再生效（每个 generation 启动时警告一次）。迁移失败时不写数据库，本次按同一张表在内存里转换后运行，记 `ambient_judge_migration_failed`，下次加载重试。
- **降级前必须先回退**：新增 `zhin ai purposes revert ambient-judge`（只能经本机网关执行），在 `purposes.ambient` 自迁移后没被修改时恢复迁移前的旧写法；旧版本读不了含 `purposes.ambient` 的模型配置。回退后当前版本仍按旧写法换算运行，不会自动再迁移。
- `DecisionEngagementJudge` 不再设内部门槛（`DecisionEngagementJudgeOptions` 新增 `timeoutMs` / `mode`，`policy` 废弃），`AmbientEngagement` 只按 `purposes.ambient` 的门槛判一次，语言模型与决策模型都是 `engage && confidence ≥ minConfidence` 才插话。`DecisionPurpose` / `DECISION_TASKS` 去掉 `ambient`（决策用途剩五类）。
- 废弃期（本 minor 和下一个 minor）：导入 `purposes.decisions.ambient` 时按迁移表合并进 `purposes.ambient`，导入结果带警告（`warnings`，路径 `purposes.decisions.ambient`）；导出只写新形状。自我变更和聊天里的 `config set` 不能再写 `ai.trigger.ambient.minConfidence` / `mode`。
- 新增 `GET {base}/agent/inference/ambient-judge`（生效的插话判断与迁移记录，Host 管理员）、`POST …/ambient-judge/migration/noticed`、`POST …/cli/purposes/revert-ambient-judge`（本机 CLI）。
- `@zhin.js/runtime`：配置 schema 中两键的描述改为「已废弃」。
