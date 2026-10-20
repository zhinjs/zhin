# @zhin.js/plugin-earthquake

地震查询与群推送插件：合并中国地震台网（CENC）与 USGS 的公开数据，按震级和地区订阅速报。不需要任何 API Key，不含适配器专用代码，所有平台通用。

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-earthquake
```

## Usage

安装命令会在主配置 `plugins` 映射中挂载 `earthquake` 实例。对应的 `zhin.config.yml` 节点：

```yaml
configVersion: 2
plugins:
  earthquake: "@zhin.js/plugin-earthquake"
earthquake: {}
```

### 命令

| 命令 | 说明 |
| --- | --- |
| `地震 [条数]` | 查询最近地震。选项：`--min/-m` 最小震级（默认 3）、`--region/-r` 地区关键词、`--hours/-t` 时间范围（小时，默认 24，最多 168）。每人 5 秒冷却 |
| `地震 订阅 [最小震级] [地区...]` | 在当前会话订阅速报，例如 `地震 订阅 5 中国`、`地震 订阅 6 日本 Japan`。不写震级时用 `defaultMinMagnitude`（默认 5）；不写地区表示全球。再次执行会覆盖原订阅 |
| `地震 退订` | 取消当前会话的订阅 |
| `地震 订阅状态` | 查看当前会话的订阅与各数据源健康状况 |

地区是对地点文字的关键词匹配（不区分大小写），同时匹配 CENC 的中文地名与 USGS 的英文地名；`中国` / `国内` 是预设，匹配 CENC 中以省级行政区开头的地点以及 USGS 中含 China / Taiwan 的地点。震级阈值按各数据源报告中的最大震级判断。

### Agent 工具

技能 `earthquake` 提供只读工具 `recent_earthquakes`（参数 `limit`、`minMagnitude`、`region`、`hours`），回答“刚才哪里地震了”之类的问题。

### 推送前提

订阅推送需要 Outbound Host 与 Schedule Host（标准 Runtime 默认提供）。配置数据库时订阅持久保存在插件状态中；没有数据库时保存在内存里，重启后丢失。

## 数据源

| 数据源 | 默认地址 | 说明 |
| --- | --- | --- |
| CENC | `https://api.wolfx.jp/cenc_eqlist.json`（主，第三方公开镜像） → `https://ceic.ac.cn/data/data.json`（备用，官网“最新地震”页面的静态数据） | 中文地名；时间为北京时间；可用 `cencUrls` 改为自建镜像 |
| USGS | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/<usgsFeed>.geojson` | 全球覆盖，作为 CENC 失败时的兜底；`usgsFeed` 默认 `2.5_day`（24 小时内 M2.5+） |

旧的 CENC 接口（`news.ceic.ac.cn/ajax/google`、`www.ceic.ac.cn/ajax/*`）已不可用，本插件不使用。两个数据源都没有公开的接口契约，解析按“容错”设计：数字字符串可接受，坏记录逐条跳过；整批都无法解析时视为该地址失败并切换下一个地址或数据源。

`地震 --hours` 超过 USGS 汇总源的时间跨度时（例如 `2.5_day` 只有 24 小时），更早的数据只来自 CENC。

## 去重

同一地震在不同数据源中的 ID、时间、震中和震级类型（CENC 的 M 与 USGS 的 mb/Mw）都会略有差异。满足以下全部条件即视为同一事件：

- 发震时间相差 ≤ 60 秒；
- 震中距离（大圆距离）≤ 100 km；
- 震级相差 ≤ 1.0（CENC M 与 USGS mb 常相差约 1 级）。

同一数据源内 ID 相同，或时间相差 ≤ 5 秒且距离 ≤ 50 km 也视为同一事件（不同 CENC 镜像会给同一地震分配不同 ID）。合并后的事件以 `sources` 中靠前的数据源作为主报告（提供地点文字）。

## 容错设计

- **超时**：每次 HTTP 请求单独超时（`requestTimeoutMs`，默认 10 秒）。
- **重试**：网络错误、超时、408/425/429/5xx 按指数退避加随机抖动重试（`maxRetries` 默认 2 次，首次等待 `retryBaseDelayMs` 1 秒，单次上限 `retryMaxDelayMs` 30 秒）；其他 4xx 不重试。
- **Retry-After**：遵守秒数或 HTTP 日期格式；要求的等待超过单次上限时本轮放弃，并让该数据源冷却到指定时间（最长 1 小时）。
- **冷却**：一轮全部失败的数据源按 30 秒、60 秒、120 秒……递增冷却，上限 10 分钟，期间由其他数据源兜底。
- **镜像切换**：CENC 的多个地址按顺序尝试。
- **条件请求**：使用 ETag / Last-Modified，数据未变化时服务器返回 304，复用缓存。
- **过期数据兜底**：所有数据源都失败时，`地震` 查询返回上次成功获取的数据并明确标注。
- **轮询不中断**：轮询从不抛错，失败只记录日志，下一轮照常执行；上一轮未结束时跳过本轮。
- **不刷屏**：每个数据源的第一次成功获取只建立基线、不推送；超过 `maxEventAgeMinutes`（默认 60 分钟）的事件不推送；每个事件只推送一次（发送前标记，发送失败只记录日志、不重试，避免重复投递）。
- **推送限流**：每个会话每 `pushWindowMinutes`（默认 10 分钟）最多 `pushLimit`（默认 3）条消息；一轮中的多个事件合并为一条消息，最多列出 `maxEventsPerMessage`（默认 5）个。被限流跳过的事件数会在下一条推送中注明。限流状态只保存在内存中。

## Configuration

所有字段均可省略，越界数值会被收敛到安全范围。完整字段见 `schema.json` 与生成的配置参考。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `sources` | `["cenc", "usgs"]` | 启用的数据源及优先顺序 |
| `cencUrls` | 见上表 | CENC 地址，按顺序尝试；仅 HTTPS，最多 5 个 |
| `usgsFeed` | `2.5_day` | USGS 汇总源 |
| `pollCron` | `0 */2 * * * *` | 订阅轮询频率（6 段 Cron） |
| `timezone` | `Asia/Shanghai` | 显示时间使用的 IANA 时区 |
| `requestTimeoutMs` | `10000` | 单次请求超时 |
| `maxRetries` | `2` | 瞬时错误重试次数 |
| `retryBaseDelayMs` | `1000` | 退避首次等待 |
| `retryMaxDelayMs` | `30000` | 单次退避 / Retry-After 上限 |
| `defaultMinMagnitude` | `5` | 订阅默认最小震级 |
| `queryMinMagnitude` | `3` | 查询默认最小震级 |
| `queryLimit` | `5` | 查询默认条数 |
| `maxEventAgeMinutes` | `60` | 只推送这么多分钟以内发生的地震 |
| `pushLimit` / `pushWindowMinutes` | `3` / `10` | 每会话推送限流 |
| `maxEventsPerMessage` | `5` | 单条推送最多列出的地震数 |
| `maxSubscriptions` | `100` | 本实例订阅总数上限 |

```yaml
earthquake:
  sources: [cenc, usgs]
  defaultMinMagnitude: 4.5
  pushLimit: 2
```

## 说明

- 地震数据仅供参考，不能替代官方预警与应急信息。
- 功能设计参考了 kivibot 的地震速报插件，但仅参考功能，代码与数据均为独立实现。
