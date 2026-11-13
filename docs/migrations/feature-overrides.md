---
title: 升级：功能覆盖迁入数据库
description: 配置文件里插件块下的 overrides（按适配器 / 账号的功能覆盖）迁入项目数据库表 feature_overrides：自动迁移的步骤、备份与记录、失败重试、迁移后的报错与改法
---

# 升级：功能覆盖迁入数据库（ADR 0057 §2）

按适配器、按账号的功能覆盖以前写在 `zhin.config.yml` 插件块的 `overrides` 下；从本版本起，它们与会话级覆盖一样存在项目数据库表 `feature_overrides` 里（[ADR 0057](../adr/0057-config-storage.md)）：

| 层级 | 以前 | 现在 |
| --- | --- | --- |
| 全局 | 插件自己的配置块；`disable_plugins` | 不变 |
| 适配器 | `<插件>.overrides.adapters.<别名>` | `feature_overrides`，`level = 'adapter'` |
| 账号 | `<插件>.overrides.endpoints."<别名>/<账号 id>"` | `feature_overrides`，`level = 'endpoint'` |
| 会话 | `feature_conversation_overrides` | `feature_overrides`，`level = 'conversation'` |

解析顺序、锁定规则与字段白名单都不变（[功能与分层配置](../console/features.md#resolution)）。改动立即生效，不需要重启；多个实例共用一个数据库时，其他实例最多 5 秒后读到。

## 1. 自动迁移

首次用新版本启动时，实例会：

1. 在读取配置前找出各插件块（含嵌套子插件块）下的 `overrides`。值里含 `${…}` 或 `env://` 引用时停止启动、不改任何文件：数据库里的覆盖不做环境变量展开，请先把引用换成字面值，或把字段移到插件的全局块；
2. 数据库加载后把每一条写入 `feature_overrides`（`updated_by` 为 `migration:<来源路径>`）。数据库里已有同一插件、同一键的覆盖时保留数据库的值。只写 `enabled: true` 的条目不导入（它本来就不起作用）；
3. 记录写入 `.zhin/migrations/feature-overrides.json`（状态 `imported`）；
4. 实例启动完成后，先把配置文件原样复制到 `.zhin/backups/feature-overrides-<时间>/`，再删除这些 `overrides` 块：原子写入，并检查配置文件自第 1 步以来没有被改过；
5. 记录改为 `done`，写明备份路径。

任何一步失败，配置文件都保持原样，下次启动重试；已经写入数据库的条目不会重复导入。第 4 步时配置文件刚好被别处改过（修订号不一致）的，也留到下次启动再删除。

会话级覆盖原来在表 `feature_conversation_overrides` 里，首次加载时按 `level = 'conversation'` 复制到 `feature_overrides`（新表已有该键时跳过）。旧表原样保留、不再写入，确认无误后可以手动删除。

没有关系型数据库（MongoDB、Redis、内存方言）时，配置文件里的覆盖只在内存中生效，配置文件不动，记录保持 `pending`（标记 `memoryOnlyAt`），直到配置了 sqlite / mysql / pg。此时 Console 与聊天的所有覆盖写入（含会话级）都会被拒绝（Console 503 `feature-overrides-unpersisted`，聊天回复「未保存」），不会出现「保存成功、重启后丢失」。

## 2. 迁移之后

迁移完成后（以及从未写过 `overrides` 的项目），配置文件里**再出现**插件块下的 `overrides`，实例启动会报错（`LEGACY_FEATURE_OVERRIDES`），运行中通过 Console 配置表单或热更新写入的也会被拒绝。请改用：

- Console：全局 / 适配器 / 账号 / 会话对象页的「功能」页签，或功能矩阵（`feature.set-override` / `feature.set-enabled` / `feature.remove-override`）；
- 聊天：开启 `features.selfService.enabled` 后发送 `功能 设置 <插件> <字段> <值> 账号|适配器`、`功能 开启|关闭 <插件> 账号|适配器`（`feature set …` / `feature enable|disable …`）。

要把一份覆盖带到新项目，目前请在新项目的 Console 中重新设置；导出功能在后续版本提供（ADR 0057 §3）。

## 3. 对插件与集成的影响

- `context.configFor(target)` / `context.isEnabledFor(target)` 不变，读到的就是数据库里的覆盖。
- 读取配置文档 `overrides` 自己计算有效配置的代码不再得到这三级覆盖，请改用 `configFor` / `isEnabledFor`。
- `feature.*` RPC 的请求与响应形状不变；适配器 / 账号级的 `revision` 改为数据库行的修订号（没有覆盖时为 `'0'`），写入时把它作为 `expectedRevision` 传回。旧版 Console 传配置文件修订号时，只要与当前一致仍可写入。
