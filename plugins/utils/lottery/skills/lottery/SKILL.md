---
description: Automated daily pipeline — sync, review, recommend, publish
---

# Lottery pipeline skill

## Scheduled flow (single cron)

The plugin runs one job (default 18:00):

1. **Sync** — pull official draws into `lottery_draws`
2. **Review** — match pending predictions to newly synced issues; tune F/O/T weights
3. **Recommend** — call the lottery recommendation tool for each enabled game
4. **Push** — send report to endpoint masters (cron only)

Manual trigger: `lottery [game]`

## Agent role

Interactive chat may use the tools owned by this lottery plugin instance. Tool names are qualified from the runtime owner, so instructions must select them by description instead of assuming an instance key. Recommended numbers must come from the lottery recommendation tool.

## Game ids

`kl8` `ssq` `dlt` `fc3d` `pl3` `pl5`

## Disclaimer

User-visible output must include: for reference only, not betting advice.
