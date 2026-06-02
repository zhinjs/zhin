---
name: skill-creator
description: "Create or improve local Zhin Agent skills. Use when asked to add a new skill, refine an existing SKILL.md, or document a repeatable workflow for the project agent."
keywords:
  - skill
  - SKILL.md
  - agent skill
  - workflow
tags:
  - agent
  - skills
---

# Skill Creator

Use this skill to create compact, task-focused Zhin Agent skills under `skills/<name>/SKILL.md`.

## Workflow

1. Identify the trigger: when should the agent use this skill?
2. Write a short description and searchable keywords.
3. Document the exact workflow, expected tools, and validation steps.
4. Keep the skill narrow. Prefer one repeatable task over a broad handbook.

## Output

Create or update `skills/<name>/SKILL.md` with frontmatter and clear execution steps. Add examples only when they prevent ambiguity.
