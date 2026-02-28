---
name: skill-creator
description: Create or update AgentSkills. Use when designing skill structure, writing SKILL.md, configuring tool associations, or organizing skill resources.
keywords: ["skill", "SKILL.md", "create skill", "skill development"]
tags: ["development", "skill-creation", "documentation"]
---

# Skill Creator

Guide for creating high-quality AgentSkills.

## What Skills Provide

1. **Specialized workflows** — multi-step processes for specific domains
2. **Tool integration** — usage instructions for file formats or APIs
3. **Domain expertise** — company-specific knowledge, data structures, business logic
4. **Bundled resources** — scripts, reference docs, and assets for complex tasks

## Core Principles

- **Concise**: Tell the model *what to do*, not *how to be an AI*
- **Secure**: If the skill uses `exec`, never allow arbitrary command injection from untrusted input
- **Testable**: Verify AI understands and executes as expected
- **Context-aware**: Full content loads only on `activate_skill`, so `description` must be clear enough for matching

## SKILL.md Anatomy

### 1. Frontmatter (YAML header)

```yaml
---
name: skill-name               # Required, kebab-case
description: What it does       # Required — AI matches skills by this field
keywords: [keyword1, keyword2]  # Optional, improves matching
tags: [category]                # Optional, for grouping
tools: [tool_name]              # Optional, associated tools
compatibility:
  os: [darwin, linux]
  deps: [git, node]
---
```

Key: `name` + `description` are the only required fields. AI decides activation based on these alone.

### 2. Body (Markdown)

Loaded only after `activate_skill` is called. Recommended structure:

```markdown
# Skill Name

Brief purpose.

## Workflow

### Step 1: Title
Instructions...

### Step 2: Title
Instructions...

## Notes
- Edge cases, security, etc.
```

## Creating a Skill

1. **Scope**: What problem does it solve? Who uses it? What tools are needed?
2. **Create directory**: `mkdir -p skills/your-skill-name`
3. **Write SKILL.md**: Clear frontmatter + actionable body
4. **Test**: Discovery → Activation → Full execution
5. **Iterate**: Refine description/keywords based on real usage

## Best Practices

### Good description
```yaml
description: Database migration tool. Use when creating, applying, or rolling back migrations. Supports SQLite, MySQL, PostgreSQL.
```

### Bad description
```yaml
description: Database operations
```

### Security for exec-based skills

```markdown
## Security
- Only operate within the project directory
- Confirm with user before any destructive action
- On permission error, prompt user to run manually
```

## Multi-file Skills

```
skills/your-skill/
├── SKILL.md
├── examples/
├── scripts/
└── references/
```

Reference sub-files from SKILL.md as needed.

## Skill Locations

- `<project>/skills/` — project-level skills
- `<project>/data/skills/` — user-defined skills

## FAQ

**Q: How long should a skill be?**
A: Body should be 500–2000 lines. Too short lacks guidance; too long hurts comprehension. Split complex flows into multiple skills.

**Q: When is a skill activated?**
A: Agent evaluates `description` + `keywords` against user messages. High-confidence matches trigger `activate_skill`.

**Q: Can skills call other skills?**
A: Not directly, but you can suggest "activate skill X if you need feature Y" in the instructions.
