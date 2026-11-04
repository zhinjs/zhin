---
"@zhin.js/agent": patch
---

Generate the `platform` prompt segment from the turn's adapter capabilities (ADR 0044 C2): fixed zh/en templates for the stable part, delivery state in `scene`, adapter `profile.prompt.text` (capped at 600 chars, `external_content` for third-party adapters) and `prompt.auto: false`.
