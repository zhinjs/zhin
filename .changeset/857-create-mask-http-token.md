---
"create-zhin-app": patch
---

Stop printing the full HTTP token when a project is created. The summary now shows a masked value with its length and points to `HTTP_TOKEN` in the project `.env`, so the token no longer ends up in CI logs.
