---
'@zhin.js/agent': major
---

Make Context System builders and injectors consume canonical Turn identity rather than Core IM `Message`. Schedule context is now selected explicitly from the Turn origin, uses a native Schedule session/principal projection, and fails closed when the job identity is absent.
