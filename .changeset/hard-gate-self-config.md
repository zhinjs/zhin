---
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
---

Gate writes to the host's own configuration with the dangerous-tool hard gate (#1030 P0). A file-tool call that writes `zhin.config.*`, `.env*`, `package.json`, lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `assistant.profile.yml`, `node_modules/` or `.git/`, and a `bash` command that writes one of them or changes dependencies, is now a dangerous `self` call: it needs a fresh human approval every time, and bypass, the auto reviewer, owner exemption and remembered approvals never grant it.
