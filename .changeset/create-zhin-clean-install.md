---
"create-zhin-app": patch
---

Fix generated Sandbox endpoint IDs and fallback configuration. Pin generated projects to pnpm 9, validate the Node 22.12+ runtime requirement before creating files, and support `--skip-install`. Validate packed candidate packages through clean installation, Sandbox messages, command hot reload and production restart.
