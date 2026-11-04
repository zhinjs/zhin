---
---

docs: `hmr.pause` / `hmr.resume` handlers run inside the Root control queue and must not await model-fetching work (#1139 P6). Adds zh/en generation-lifecycle docs and guard tests; no package release, no runtime change.
