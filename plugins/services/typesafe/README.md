# TypeSafe Decision Provider

Publishes the real TypeSafe Choice, Score and Noul protocol for Zhin's operation-bound inference runtime. It does not turn chat JSON into a decision model.

```sh
pnpm add @zhin.js/service-typesafe
```

Register the plugin normally:

```yaml
configVersion: 2
plugins:
  typesafe: '@zhin.js/service-typesafe'
```

The plugin has no account or model settings. Add its Service, Account and Profiles through Host inference management; keep the API key in the Account credential store or an `env://TYPESAFE_API_KEY` source reference. A reviewed plan can declare multiple models and select a Profile separately for each task:

```yaml
version: 1
services:
  decision:
    driver: typesafe
    models:
      jev-pinned:
        id: jev-pinned
        kinds: [decision]
        protocol: typesafe-system-one
accounts:
  deployment:
    service: decision
    auth:
      method: api-key
      source: env://TYPESAFE_API_KEY
profiles:
  routing:
    account: deployment
    model: jev-pinned
    parameters:
      timeoutMs: 10000
      maxRetries: 2
purposes:
  decisions:
    skills:
      profile: routing
      mode: shadow
    tools:
      profile: routing
      mode: shadow
```

Import previews resolve the Driver's exact Plugin owner and contract version. Applying a plan does not execute a model request. The former `typesafe.apiKey`, `model`, `enabled` and `ai.decisions.provider` configuration is removed; migrate it explicitly rather than running parallel clients. The old `zhin setup --decisions` format is not the target management path.

A normal plugin receives `aiInferenceClientToken` from its actual operation context and calls `evaluate` with an eligible Decision Profile reference. `evaluate` returns the supplier's typed answers, actual model and usage; task policies apply their own `off`, `shadow` or `active` behavior. Merely installing this plugin does not enable any decision policy.

- Choice retains the selected label, complete probability distribution and confidence.
- Score retains the rubric index, rubric legend, distribution and confidence. Its range follows the supplied rubric.
- Noul is a probability of true and has no separate confidence value.
- Deterministic identity, permission and approval checks remain authoritative.

`timeoutMs` bounds the whole SDK operation, including body consumption and configured retries. Every actual HTTP attempt obtains a current Account grant. Errors contain safe local codes and optional status, without provider bodies or credentials. Operation cancellation closes the ephemeral SDK client; retiring a Plugin generation does not itself cancel a retained operation.

```sh
pnpm --filter @zhin.js/service-typesafe test
pnpm --filter @zhin.js/service-typesafe build
```

Tests run the installed official SDK against synthetic HTTP fixtures. They do not establish real-account accuracy, latency, availability, provider permission or production cost.


The target interface requires the coordinated Provider release: `@zhin.js/ai >=1.1.51` and `@zhin.js/ai-provider >=1.0.0` (planned, not published by this change). Upgrade the Host and plugin together; the [migration guide](../../../docs/ai/provider-upgrade.md) lists the full version boundary. The root exports `typeSafeProvider` and safe decision errors; the old API-key constructor and its configuration type are no longer public author APIs.


## Migrating the former plugin configuration

The general headless importer does not execute plugin JavaScript to discover private configuration. A blocked TypeSafe entry requires this explicit migration, not a second legacy client:

1. Stop the old Host for the migration window. Keep a protected backup of its configuration, package versions, database and matching credential master key. Record the effective TypeSafe endpoint, exact native model ID, timeout/retry values and each decision task's existing policy; do not copy key material into a plan, log or issue. If the effective old model cannot be established, select an exact native ID before proceeding.
2. Replace the old configured plugin with the normal pure plugin declaration shown above. Remove the former plugin fields (`apiKey`, `model`, `enabled`, `baseUrl`, `timeoutMs`, `maxRetries`); even `enabled: false` is not the new plugin schema. Keep the old source in the protected backup. Keep an existing environment secret available privately if the new Account will refer to it.
3. Start the coordinated new Host and open its model management page in Console. Add a Service using the registered `typesafe` Driver and the old explicit endpoint. Declare the exact native model with `kinds: [decision]` and `protocol: typesafe-system-one`. This is a manual declaration, not a claim that a catalogue probe verified the model.
4. Add its Host Account with authentication `api-key`: either use the existing Host source reference, such as `env://TYPESAFE_API_KEY`, or submit the key through the authenticated private Account form. Create a Profile selecting that Account and native model; copy the old `timeoutMs` and `maxRetries` into Profile parameters. The plugin itself stores neither credentials nor a selected model.
5. Bind the Profile separately to the six decision purposes: `skills`, `tools`, `memory`, `agents`, `approval`, and `ambient`. Copy each task's original `mode`, `timeoutMs`, `minConfidence`, `topK`, `maxCandidates` and `maxSelections` where configured. Do not enable previously disabled tasks, invent new thresholds, or copy one task's policy over the others. Remove the obsolete `ai.decisions.provider` and old startup task routes only as part of this explicit cutover; the new runtime does not dual-read them.
6. Save through the normal management transaction and inspect the selected Service, Account, Profile and purpose bindings. Saving does not perform model inference. Real model acceptance and billing require a separately authorized test; offline validation is not that evidence. If a save outcome is unknown, query its original mutation receipt before retrying.

To restore the old release, stop the new Host and restore the old package/configuration set together with its matching database and credential-key backup. Do not point the old client at the new Provider graph or re-enable a legacy client alongside the new one.
