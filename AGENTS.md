## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `zhinjs/zhin`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a multi-context domain documentation layout with root `CONTEXT-MAP.md`, system ADRs in `docs/adr/`, and context-local `CONTEXT.md` / ADRs where applicable. See `docs/agents/domain.md`. **Bridge v1 glue (DX, packages, e2e):** `docs/bridge/index.md` (issue [#413](https://github.com/zhinjs/zhin/issues/413)).

### 可靠的开发流程 (`reliable-dev-workflow`, generic skill)

For **non-trivial features or substantial refactors** (see **[`.cursor/skills/reliable-dev-workflow/references/exemptions-and-scope.md`](.cursor/skills/reliable-dev-workflow/references/exemptions-and-scope.md)** for **trivial-task exemptions**, work root, secrets, and index etiquette):

0. If **`.history/index.md`**, **`.notice/index.md`**, or **`.feature/README.md`** is missing, run **`node .cursor/skills/reliable-dev-workflow/scripts/bootstrap.mjs`** (optional repo path; or set **`FEATURE_DRIVE_ROOT`** when no path arg).
1. Read **`.history/index.md`** and **`.notice/index.md`** first (then linked entries), align with code and domain docs.
2. Resolve ambiguities with the user **before coding**; update history/notice when shared understanding changes.
3. Copy **`.feature/<slug>/plan.md`** and **`todo.md`** from **[`.cursor/skills/reliable-dev-workflow/templates/`](.cursor/skills/reliable-dev-workflow/templates/)** (bundled with the skill), **get user confirmation**, then implement; tick todos and stay aligned with the plan during work. **No secrets in plan/summary** (see exemptions doc §4).
4. Finish with **`summary.md`**, append **`.history/<slug>.md`** and **`index`** (and **`.notice`** as needed); **append-only** new rows to index tables when possible (exemptions §5).

Entry: **[`.cursor/skills/reliable-dev-workflow/SKILL.md`](.cursor/skills/reliable-dev-workflow/SKILL.md)**. Phase details: **[`references/phases/README.md`](.cursor/skills/reliable-dev-workflow/references/phases/README.md)**. Missing scaffold: **`node .cursor/skills/reliable-dev-workflow/scripts/bootstrap.mjs`**. **Zhin 文档站（`docs/`）不收录本技能**；人类与 Agent 仅以仓库内 **`.cursor/skills/reliable-dev-workflow/`** 为准。Share: whole **`reliable-dev-workflow/`** folder (`templates/` + `scripts/` + **`references/`**).
