# @zhin.js/plugin-teach

> 自定义问答插件 —— 教会你的 Bot 自动应答

[![npm version](https://img.shields.io/npm/v/@zhin.js/plugin-teach.svg)](https://www.npmjs.com/package/@zhin.js/plugin-teach)
[![license](https://img.shields.io/npm/l/@zhin.js/plugin-teach.svg)](LICENSE)

## 简介

`@zhin.js/plugin-teach` 是 Zhin.js 的自定义问答插件，灵感来自 Koishi 的 teach 插件。用户可以在聊天中教会 Bot 问答对，Bot 会自动匹配并回复。支持精确匹配和正则匹配，适用于群聊和私聊场景。

## 特性

- **精确匹配** — 问题完全一致时自动回复
- **正则匹配** — 支持正则表达式，回答可引用捕获组 (`$1`, `$2`...)
- **上下文隔离** — 群聊问答仅在本群生效，私聊问答全局生效
- **模板变量** — 回答中可使用 `{sender}`, `{time}`, `{date}` 等动态内容
- **冷却机制** — 防止同一问答短时间内重复触发
- **数量限制** — 可配置每群最大问答数
- **AI 工具** — AI Agent 可查询问答库和统计信息
- **数据库持久化** — 基于 Zhin 内置数据库，支持 SQLite / MySQL / PostgreSQL

## 安装

```bash
npm install @zhin.js/plugin-teach
# 或
pnpm add @zhin.js/plugin-teach
```

## 配置

在 `zhin.config.yml` 中添加插件：

```yaml
plugins:
  - "@zhin.js/plugin-teach"

# 可选配置
teach:
  maxPerGroup: 200    # 每群最大问答数（默认 200）
  cooldown: 3000      # 同一问答触发冷却时间 ms（默认 3000）
  allowRegex: true    # 是否允许正则问答（默认 true）
  pageSize: 10        # 列表每页条数（默认 10）
```

## 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `teach <问题> <回答>` | 添加/更新精确匹配问答 | `teach 你好 你好呀~` |
| `teach-regex <正则> <回答>` | 添加/更新正则匹配问答 | `teach-regex ^(早安\|早上好)$ 早安，{sender}！` |
| `forget <问题>` | 删除一条问答 | `forget 你好` |
| `teach-list [页码]` | 查看当前上下文的问答列表 | `teach-list 2` |

## 模板变量

在回答中可以使用以下变量：

| 变量 | 说明 | 示例输出 |
|------|------|----------|
| `{sender}` | 发送者昵称 | `张三` |
| `{sender.id}` | 发送者 ID | `123456` |
| `{time}` | 当前时间 | `14:30:00` |
| `{date}` | 当前日期 | `2026/3/5` |
| `$1`, `$2`... | 正则捕获组（仅正则问答） | 对应匹配内容 |

### 示例

```
teach 你好 你好呀，{sender}！现在是 {time}
teach 晚安 晚安~{sender}，做个好梦
teach-regex ^天气(.+)$ 你想查 $1 的天气？请使用 /天气 $1
teach-regex ^(早安|早上好|早)$ 早安，{sender}！今天也要元气满满哦~
```

## AI 工具

插件注册了以下 AI 工具，Agent 可自动调用：

| 工具名 | 说明 |
|--------|------|
| `teach_query` | 查询问答库，支持关键词模糊搜索 |
| `teach_stats` | 查看问答库统计（总数、分布、热门排行） |

## 数据库

插件使用 Zhin 内置的数据库服务，自动创建 `teach_qa` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 自增主键 |
| `question` | text | 问题/正则表达式 |
| `answer` | text | 回答模板 |
| `is_regex` | integer | 是否正则（0/1） |
| `context_type` | text | 上下文类型（global/group） |
| `context_id` | text | 群号（群聊时） |
| `creator_id` | text | 创建者 ID |
| `creator_name` | text | 创建者昵称 |
| `hit_count` | integer | 命中次数 |
| `created_at` | text | 创建时间 |
| `updated_at` | text | 更新时间 |

## 依赖

- `zhin.js` >= 1.0.42
- 需要启用 `database` 服务

## 许可证

MIT
