---
title: Send feed updates to a specific conversation
description: Create administrator RSS tasks with exact targets and baseline-only first and resumed checks
---

# Send feed updates to a specific conversation

In Console's task center, select a loaded RSS instance, enter a feed URL and a complete delivery target, then create an administrator subscription. The first successful check establishes a baseline; only later articles are sent. Resuming also establishes a new baseline without backfill. No AI or impersonated chat sender is required.

## Prepare the plugin and target

Inspect the use case and installation plan:

```bash
zhin use-cases rss-subscription
zhin install @zhin.js/plugin-rss --dry-run
```

Install and load the plugin through the existing installation flow. Configure a persistent Database Host, Schedule Host and Outbound Host supporting exact `sendTarget` delivery. Without all three, the RSS instance exposes no administrator task provider. See the [RSS plugin README](https://github.com/zhinjs/zhin/tree/main/plugins/utils/rss) for configuration.

The instance's `pollCron` controls polling, every five minutes by default. Scheduling uses the Host's actual timezone. Task details show the expression and last check without inventing a next-run time. A failed feed fetch is checked again next round; it is not a delivery attempt.

## Create and verify

Open the task center using a full-scope token for the current Host. Select the exact instance and administrator RSS provider. Enter an HTTP(S) feed URL without username or password. Select the account, conversation kind and ID, preserving parent and thread identities. Enter exact IDs manually when the platform has no directory; display names cannot replace addresses.

Review the listed fetching and delivery effects before creating. Creation only saves the task: it does not fetch the feed or send a test message. Wait for a successful check whose details confirm the baseline. Add one article to a controlled test feed, wait for the next poll, then check the task result and original target conversation separately. Real-platform validation requires an authorized test target. Successful storage proves neither account connectivity nor delivery.

Updates use the existing readable text format through the unified send pipeline. Article titles, links and omitted-item counts remain in the body; images, Markdown and buttons are not required.

## Pause, edit and handle uncertain delivery

Pause before changing the URL. Resuming establishes a new baseline. Pausing or cancelling prevents future checks but cannot retract delivery already in progress. Each subscription persists its own deduplication cursor, separate from chat subscriptions.

An uncertain state is persisted before sending. Only a confirmed message ID returns the task to polling; definite non-delivery stops it. `unknown`, a missing confirmed ID or process interruption never causes an automatic retry or a resume button. Inspect the original conversation and reconcile first. Cancelling and creating another subscription starts a new baseline without replaying old articles.

Administrator and chat subscriptions have separate management. `rss-list`, `rss-remove` and `rss-check` cannot read, cancel or trigger administrator tasks. Chat commands currently reject addresses with parents or threads; administrator targets preserve those fields.

## Polling window and capacity

Each check examines the first 20 items returned by the feed without following older pages. `maxItems` displays five articles by default. If more new articles are found in one check, the message includes an omitted count and source-site hint. All examined articles enter the cursor; omitted details are not sent next round. Initial and resumed baselines also cover only the current window, so this is not permanent archival or lossless delivery.

Each instance retains at most eight administrator tasks and 32 operation receipts. Each subscription retains 64 item-identifier digests. Creation may prune cancelled or failed history, but never uncertain tasks. Invalid durable data stops administrator polling while preserving the data for investigation.

See the [administrator task center](../paths/console.md#administrator-task-center) for operations and reconciliation after a lost response.
