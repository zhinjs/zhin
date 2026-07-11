---
description: Automated daily pipeline — sync, review, recommend, publish
tools:
  - lottery_sync
  - lottery_stats_snapshot
  - lottery_compute_recommend
  - lottery_save_prediction
  - lottery_get_model_state
  - lottery_list_pending
  - lottery_history
---

# Lottery pipeline skill

## Scheduled flow (single cron)

The plugin runs one job (default 18:00):

1. **Sync** — pull official draws into `lottery_draws`
2. **Review** — match pending predictions to newly synced issues; tune F/O/T weights
3. **Recommend** — `lottery_compute_recommend` per enabled game
4. **Push** — send report to endpoint masters (cron only)

Manual trigger: `lottery [game]`

## Agent role

Interactive chat may use `lottery_*` tools — numbers must come from `lottery_compute_recommend`.

## Game ids

`kl8` `ssq` `dlt` `fc3d` `pl3` `pl5`

## Disclaimer

User-visible output must include: for reference only, not betting advice.
