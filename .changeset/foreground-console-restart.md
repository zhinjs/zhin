---
"@zhin.js/cli": patch
---

Keep foreground runtime starts under the process supervisor even when Node supports native TypeScript, so an authorized Console restart restores the Host instead of leaving it stopped with exit code 75. Ordinary foreground failures and once-mode exits keep their existing behavior.
