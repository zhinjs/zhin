---
name: content-moderation
description: Check text against content moderation policies and inspect moderation engine status.
keywords:
  - 审核
  - 内容安全
  - 敏感词
  - moderation
  - safety
tags:
  - moderation
  - security
tools:
  - moderation_check
  - moderation_status
---

# Content Moderation Skill

Provides read-only content safety diagnostics and moderation engine inspection.

## Tools

| Tool | Purpose |
|------|---------|
| `moderation_check` | Dry-run text against active content moderation policies and report severity, matched rules, and actions. |
| `moderation_status` | Inspect current moderation engine configuration, active providers, sensitivity, and pending review queue count. |
