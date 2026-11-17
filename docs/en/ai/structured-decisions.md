---
title: "Structured Decisions"
description: "Create Profiles for several judgment models and choose real Choice, Score, and Noul services per purpose."
---

# Structured decisions

A structured decision model handles questions that have explicit candidates and criteria, such as tool / Skill recommendation, memory ranking, Agent selection and approval assistance; it can also be the model of the [interjection judge](./index.md#interjection-judge). It returns reasoning evidence only and never widens permissions; activation, approval, and execution stay with the business module.

## Configure several models

Install the matching Driver plugin, for example `@zhin.js/service-typesafe`, then create a Service, an Account, and a `decision` Profile in Console. They share the same catalog and persistence as chat models and are no longer bound to one global decision owner.

TypeSafe import proposal example:

```yaml
# ai.plan.yml
version: 1
services:
  decisions:
    driver: typesafe
    models:
      your-decision-model:
        id: your-decision-model
        kinds: [decision]
        protocol: typesafe-system-one
accounts:
  first:
    service: decisions
    auth:
      method: api-key
      source: env://TYPESAFE_API_KEY
profiles:
  fast:
    account: first
    model: your-decision-model
    parameters:
      timeoutMs: 3000
  careful:
    account: first
    model: your-decision-model
    parameters:
      timeoutMs: 5000
purposes:
  decisions:
    tools:
      profile: fast
      mode: shadow
    approval:
      profile: careful
      mode: active
```

Replace the example model ID with a value the service actually supports. The currently installed instance of a Driver must be uniquely identifiable; when Drivers with the same name come from different plugins, the preview requires `{ id, owner, contractVersion }` and never picks the newest one.

## Each purpose works independently

The five purposes are `skills`, `tools`, `memory`, `agents`, and `approval`. Each one selects a Profile and keeps its existing purpose policy (the former sixth purpose `ambient` moved into the interjection judge `purposes.ambient`, which takes a decision model directly or mixed with language models in its fallback chain, see the [migration notes](../migrations/ambient-judge.md)):

- `off` does not call the model.
- `shadow` records the suggestion while the business keeps its original way of deciding.
- `active` hands the suggestion to that business's apply flow.

Thresholds, candidate counts, timeouts, and similar settings are still validated by the matching purpose policy, and switching Profiles never relaxes permissions. A legitimate "choose nothing" is different from a service failure; a successful apply is recorded after the business confirms it and never marked as success when the model answers. The interjection judge is not one of these five purposes: `purposes.ambient` has one model choice with a mixed fallback chain and one threshold, `purposes.ambient.minConfidence`.

## Calling from an ordinary plugin

```ts
const models = context.use(aiInferenceClientToken);
const profiles = await models.list({ kind: 'decision' });
const selected = profiles.find(profile => profile.label === 'Careful');
if (!selected) throw new Error('Decision Profile unavailable');
const evidence = await models.evaluate({
  profile: selected.reference,
  state: { topic: 'synthetic task' },
  questions: {
    relevant: { type: 'choice', criteria: { read: 'Read existing facts', search: 'Find missing facts' } },
  },
});
```

The question schema must follow the real contract of the Driver in use. `evaluate` does not pose as one of the five purposes above and returns no `applied` / `off` state. Choice, Score, and Noul use the vendor's real results; a chat model that produces JSON is not enough to claim this contract.

A failed call never switches to a model or Account that was not selected. A personal quota or other pre-submit admission refusal is not retried automatically by the TypeSafe SDK as a network error. An unknown result for a submitted request and a request that was definitely not submitted are recorded separately; a single HTTP success or a mock result is not proof that the real vendor accepted it.
