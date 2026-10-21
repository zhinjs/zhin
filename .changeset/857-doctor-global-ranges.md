---
"@zhin.js/cli": patch
---

`zhin doctor --fix`（含 `--upgrade-l4 --fix`）补写依赖和 `~/.zhin` 全局实例初始化不再写 `latest`，改为使用 `@zhin.js/scaffold-wizard` 随发布生成的真实版本范围（如 `^1.1.11`）；拿不到版本的包仍保留 `latest`。
