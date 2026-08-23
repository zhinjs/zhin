---
title: 文档内容数据闭环
---

# 用真实问题持续改进文档

Zhin 文档站内置一个供应商无关、默认关闭的内容洞察客户端。只有部署者配置采集 Endpoint、访问者明确同意且浏览器未开启 DNT 时，它才发送匿名事件。它不使用 Cookie，不创建用户或设备 ID，也不发送 URL 查询参数、fragment、外部 referrer、IP 字段或浏览器指纹。

这个闭环回答四个产品问题：用户在找什么、什么没找到、哪些旧链接已失效，以及用户从哪些页面离开。它不是用户行为画像系统。

## 接入采集 Endpoint

在 GitHub 仓库的 Pages 部署环境配置两个 Actions Variables：

| Variable | 必填 | 说明 |
| --- | --- | --- |
| `DOCS_INSIGHTS_ENDPOINT` | 是 | 接收匿名 JSON `POST` 的 HTTPS 地址 |
| `DOCS_INSIGHTS_SITE_ID` | 否 | 数据集名称，默认 `zhin-docs`，最长 40 字符 |

工作流会把它们构建为 `VITE_DOCS_INSIGHTS_ENDPOINT` 与 `VITE_DOCS_INSIGHTS_SITE_ID`。没有 Endpoint 时，客户端和同意提示都不工作；这保证本地开发、fork 与未配置环境不会意外采集。

Collector 应接受 `content-type: application/json`，返回任意 2xx，并限制请求体大小、速率与保留期。跨域 Collector 需要只允许文档站 origin。不要在 Collector 侧补充 IP、User-Agent 或身份标识。

## 事件契约

所有事件都含 `schemaVersion`、`event`、无 query/hash 的 `path`、`locale`、`viewport` 和 `siteId`。

| 事件 | 额外字段 | 用途 |
| --- | --- | --- |
| `page_view` | `previousPath`（仅站内路径） | 衡量内容到达与导航发现性 |
| `page_exit` | `previousPath`、`dwell` 区间 | 找到高频退出页和过短停留页 |
| `not_found` | `previousPath` | 发现 404 路径与站内断链 |
| `search` | `searchTerm`、`resultCount` | 找到高频用户语言与已有内容 |
| `search_no_results` | `searchTerm`、`resultCount=0` | 确定最值得补充的解决方案 |

搜索词最长 64 字符且只允许自然语言字母、数字、空格与连字符。邮箱、URL、Token/Secret、长哈希、字母数字混合凭据与疑似密钥不会发送原文，只发送 `searchRedacted: true`。`dwell` 仅有 `under_10s`、`10s_to_60s`、`1m_to_5m`、`over_5m` 四档；首次同意前的停留不会计入。

## 每周内容评审

每周固定一次 30 分钟评审，不按单条事件追逐页面：

1. 聚合 `search_no_results`，按规范化搜索词排序。前三项要么新增解决方案，要么补同义词与入口。
2. 聚合 `not_found` 的 `path + previousPath`。站内来源修链接；外部遗留路径配置重定向或迁移说明。
3. 按 `page_exit.path + dwell` 聚合。高访问、短停留且高退出的页面优先重写开头、操作路径与下一步。
4. 对照 `search` 与 `page_view`：已经有答案却仍被频繁搜索的内容，应提升导航和页面内标题，而不是复制新页面。
5. 每项优化记录基线、改动、负责人和下一次复核日期；连续两周无改善就回滚假设，重新检查用户意图。

建议只查看至少 10 次事件的聚合项，避免对极小样本做判断。原始事件保留不超过 30 天，聚合趋势可保留更久。

## 验证

本地验证时临时构建一个同源测试 Endpoint：

```bash
VITE_DOCS_INSIGHTS_ENDPOINT=/__docs-insights \
VITE_DOCS_INSIGHTS_SITE_ID=zhin-docs-local \
pnpm docs:build
```

预览站点，在同意提示中选择“同意匿名统计”，然后：

1. 打开一个正常页面，Collector 应收到 `page_view`。
2. 搜索一个存在的词和一个随机不存在的词，应分别收到 `search` 与 `search_no_results`。
3. 打开不存在的路径，应收到 `not_found`。
4. 导航离开或关闭页面，应收到 `page_exit`，且路径不含 `?` 或 `#`。
5. 把同意值改为拒绝，或开启 DNT，重复操作不应再产生请求。

自动门禁由 `pnpm vitest run tests/docs/docs-insights.test.ts tests/docs/content-insights-loop.test.ts` 覆盖字段最小化、敏感词脱敏与运维契约。

访问者随时可以点击页面右下角“隐私”重新选择；选择拒绝会立即停止后续采集。也可以删除浏览器站点数据中的 `zhin:docs-insights-consent:v1` 重置选择。
