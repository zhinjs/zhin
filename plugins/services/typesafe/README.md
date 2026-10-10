# TypeSafe AI decisions

`@zhin.js/service-typesafe` is an optional, generation-owned [TypeSafe AI Jev](https://docs.typesafe.ai/sdk/javascript) decision provider. It evaluates named Choice, Score and Noul questions; it does not generate chat replies or grant tool permissions. The default IM installation does not include the SDK.

## Install and configure

```sh
pnpm add @zhin.js/service-typesafe
```

Keep the API key in `.env`:

```dotenv
TYPESAFE_API_KEY=your-key
```

Run the optional wizard after configuring your chat Agent:

```sh
zhin setup --decisions
pnpm install
zhin doctor
```

The wizard keeps your chat model, writes the key to `.env`, installs the plugin manifest entry and starts Skill / Tool recommendations in `shadow` mode. On first setup, Agent selection, memory reranking and automatic approval start `off`. Reconfiguration preserves existing task settings and thresholds. Separate instances use separate key environment variables; an existing explicit key reference is preserved.

For manual configuration, declare the plugin in `package.json`:

```json
{
  "zhin": {
    "plugins": [{ "package": "@zhin.js/service-typesafe", "instanceKey": "typesafe" }]
  }
}
```

Add its instance settings and exact binding in `zhin.config.yml`, alongside the existing AI configuration:

```yaml
plugins:
  typesafe:
    apiKey: ${TYPESAFE_API_KEY}
    model: jev-latest
    timeoutMs: 10000
    maxRetries: 2
ai:
  # Keep existing agents/providers and other AI settings.
  decisions:
    provider: root/typesafe
    skills:
      mode: shadow
    tools:
      mode: shadow
```

The instance registers its client through `provideAgentDecisionProvider` from `@zhin.js/agent/runtime` in its own plugin scope. The registration binds the resource to its owning instance, so an inherited ancestor provider cannot satisfy a different configured instance. Agent configuration must explicitly bind the instance through the runtime decision configuration; merely installing a provider does not authorize decisions or change existing routing. Independent instances have independent clients and lifecycle cleanup.

`schema.json` is the configuration contract. `timeoutMs` covers the whole call, including HTTP attempts and retry delays. A caller can supply its own total budget. `enabled: false` skips client creation and does not require a key. `baseUrl` defaults to `https://api.typesafe.ai`; custom roots cannot contain credentials, query strings or fragments.

Invalid configuration for an enabled instance stops plugin startup with a sanitized error instead of silently disabling the configured decision or approval provider. Resolve the environment reference or configuration error before restarting; use `enabled: false` to explicitly disable the instance.

## Use the decision interface

```ts
import { TypeSafeDecisionProvider } from '@zhin.js/service-typesafe';

const provider = new TypeSafeDecisionProvider({
  apiKey: process.env.TYPESAFE_API_KEY!,
  model: 'jev-latest',
});
try {
  const result = await provider.evaluate({
    state: { intent: 'Mute a group member' },
    questions: {
      skill: {
        type: 'choice',
        instructions: 'Choose the relevant permitted skill, or none.',
        criteria: { moderation: 'Group moderation', none: 'No relevant skill' },
      },
    },
  }, { signal: new AbortController().signal });
  console.log(result.answers.skill.choice); // inferred: 'moderation' | 'none'
} finally {
  provider.dispose();
}
```

Use the plugin-managed resource in normal Zhin operation; direct construction is useful for standalone consumers and tests. Do not create clients for each message.

## Result semantics and safety

- Choice preserves the selected label, its complete probability distribution and reported confidence.
- Score preserves the expected rubric index, rubric legend, probability distribution and confidence. A two-level rubric has a score in `[0, 1]`; a five-level rubric has a score in `[0, 4]`.
- Noul is the probability of true in `[0, 1]`. It has no separate confidence field.
- Every result includes the actual model name and token usage. Policy versioning and decision thresholds belong to the caller, not this transport.

The native API's top-level state, instructions and criterion descriptions accept strings, arrays, objects and null. Numeric and boolean data can appear inside objects or arrays. Non-finite numbers, cycles and unsupported entry types are rejected before dispatch. Responses are validated against the submitted question names, types, alternatives and score rubric. Missing answers, malformed distributions and invalid usage are rejected.

SDK logging is disabled, including when `TYPESAFE_LOG_LEVEL` is set. Errors expose only a local code and, when available, an HTTP status. Remote bodies, prompts, credentials and upstream causes are not attached to errors. Caller cancellation, total timeout and plugin disposal also cancel pending SDK retries.

Jev's decisions are advisory. Zhin's deterministic identity, permission and approval rules remain authoritative. Pin a model version before calibrating a production policy, and evaluate Chinese requests on representative scenarios; the SDK's `jev-latest` alias can change over time.

## Validation

```sh
pnpm --filter @zhin.js/service-typesafe test
pnpm --filter @zhin.js/service-typesafe build
```

Tests use the real SDK with injected HTTP fetch and make no paid API calls. Real-account accuracy, latency and cost must be measured separately before enabling production policy.
