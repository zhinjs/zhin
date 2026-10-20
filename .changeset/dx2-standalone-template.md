---
"@zhin.js/cli": patch
---

`zhin new` templates use `@zhin.js/testing` (no `as never`) and ship every convention directory (`tools/`, `middlewares/`, …) without extra `files`/tsconfig edits; missing arguments fail fast without a TTY; standalone hints no longer suggest `pnpm add <plugin dir>`, which creates duplicate zhin package instances; `zhin search` links to npm instead of a 404 page.
