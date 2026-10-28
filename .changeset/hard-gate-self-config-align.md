---
"@zhin.js/agent": patch
"@zhin.js/cli": patch
---

Align the host self-configuration hard gate with the final #1030 P0 spec. `node_modules/**` (any depth), package-manager lockfiles and the plugin lifecycle file are now denied outright for every role, with no approval card. The `self` hard gate is anchored to the project root (symlink-, `..`- and case-safe) and covers the root config files, `package.json`, `schema.json`, the root plugin entry, `AGENTS.md`, the skills directories, `.git/`, `.pnpmfile.cjs` and `assistant.profile.yml`; nested files such as `plugins/x/package.json` are no longer gated, and `pnpm-workspace.yaml` / `tsconfig*.json` are not managed. The host provides the project root and extras per generation through `hostProtectedPathsToken` (carried on each Turn); without it the gate fails closed to name matching at any depth.
