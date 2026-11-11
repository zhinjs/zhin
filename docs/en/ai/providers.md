---
title: "Model Services and Subscription Accounts"
description: "Manage API keys, OAuth subscriptions, and structured decisions with one Service, Account, and Profile configuration."
---

# Model Services and Subscription Accounts

Zhin stores model settings in the Host database. On first startup, if the database has no model configuration yet, `ai.plan.yml` in the project root is imported automatically as the initial configuration. After that, once you save a change in Console the next call uses the new settings, calls already in flight keep the choice they started with, and the process does not need a restart.

## `ai.plan.yml` quick templates for common vendors

Run `npx zhin setup --ai` to generate the configuration below interactively. You can also copy the matching template to `ai.plan.yml` in the project root and put the key in `.env`:

::: code-group

```yaml [DeepSeek]
# ai.plan.yml (set DEEPSEEK_API_KEY=sk-... in .env)
version: 1
services:
  deepseek:
    driver: deepseek
    models:
      deepseek-chat:
        id: deepseek-chat
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: deepseek
    auth:
      method: api-key
      source: env://DEEPSEEK_API_KEY
profiles:
  daily:
    account: default
    model: deepseek-chat
purposes:
  chat:
    profile: daily
```

```yaml [OpenAI]
# ai.plan.yml (set OPENAI_API_KEY=sk-... in .env)
version: 1
services:
  openai:
    driver: openai
    models:
      gpt-4o:
        id: gpt-4o
        kinds: [language]
        protocol: openai-chat
        input: [text, image]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: openai
    auth:
      method: api-key
      source: env://OPENAI_API_KEY
profiles:
  daily:
    account: default
    model: gpt-4o
purposes:
  chat:
    profile: daily
```

```yaml [Qwen / DashScope]
# ai.plan.yml (set DASHSCOPE_API_KEY=sk-... in .env)
version: 1
services:
  dashscope:
    driver: openai-compatible
    options:
      baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    models:
      qwen-plus:
        id: qwen-plus
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: dashscope
    auth:
      method: api-key
      source: env://DASHSCOPE_API_KEY
profiles:
  daily:
    account: default
    model: qwen-plus
purposes:
  chat:
    profile: daily
```

```yaml [Local Ollama]
# ai.plan.yml (local connection without authentication)
version: 1
services:
  local:
    driver: ollama
    options:
      baseUrl: http://127.0.0.1:11434/v1
    models:
      qwen3:8b:
        id: qwen3:8b
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  bot:
    service: local
    auth:
      method: none
profiles:
  daily:
    account: bot
    model: qwen3:8b
    parameters:
      maxOutputTokens: 4096
purposes:
  chat:
    profile: daily
```

:::

## Three core objects

- **Service**: which Driver, product, and API address to use, plus that service's model catalog.
- **Account**: one access identity on that service, using an API key (`env://VAR` or a private key stored in Console), OAuth, or a local connection without authentication.
- **Profile**: selects an Account, a native model ID, and generation parameters. One Account can have several Profiles.

Chat (`chat`), summaries (`compaction`), ambient listening (`ambient`), image perception (`perception`), image generation (`image`), Agent roles, and the six kinds of structured decisions are all bound by choosing a Profile; a purpose never copies keys or API addresses. See [Personal Sessions and Model Policy](./model-policy.md).

## Configure in Console

1. **Create a Service**: fill in the Driver's public form; when adding a model, state its protocol, call contract, and capabilities (`input`, `streaming`, `toolCalling`) explicitly.
2. **Create an Account**: save an API key, or start an OAuth login on a Host subscription account (finish authorization on the vendor's page, then paste the final browser callback URL back into Console; Zhin does not start a local callback listener automatically).
3. **Create a Profile and bind purposes**: assign the Profile to purposes such as `chat`. API keys and OAuth tokens are stored in Host-private encrypted records and never appear in Profiles, Sessions, prompts, or ordinary management responses.

## Subscriptions and API protocols

| Driver | Authentication | Call contract |
| --- | --- | --- |
| `openai` | API key | OpenAI Chat, Responses, Images |
| `anthropic` | API key | Anthropic Messages |
| `google` | API key | Gemini generateContent, Images |
| `deepseek` | API key | OpenAI Chat |
| `minimax` | API key | Anthropic Messages, MiniMax Images |
| `cloudflare` | API key | OpenAI Chat, Cloudflare Images |
| `ollama` | None or API key | OpenAI Chat |
| `openai-compatible` | API key | OpenAI Chat, Images |
| `codex-subscription` | OAuth | Codex Responses |
| `claude-subscription` (experimental) | OAuth | Claude subscription Messages |
| `opencode-go` / `opencode-zen` | Each product's API key | Decided by the protocol explicitly chosen in the service catalog |
| `antigravity` (experimental) | OAuth | Antigravity generateContent |

Claude subscription and Antigravity: experimental · no vendor support · may violate the vendor's terms · used at your own risk. Codex: OpenAI has not explicitly authorized third-party clients.

## Calling from a plugin

When a plugin needs to call a model directly, get a client bound to the current execution scope through `aiInferenceClientToken`:

```ts
import { defineCommand } from '@zhin.js/command';
import { aiInferenceClientToken } from '@zhin.js/ai/provider';

export default defineCommand({
  description: 'List available model profiles',
  async execute(context) {
    const models = context.use(aiInferenceClientToken);
    const profiles = await models.list({ kind: 'language' });
    return profiles.map(profile => profile.label ?? profile.reference.id).join('\n');
  },
});
```

The Host binds the client to the real execution scope of this call and closes it automatically when the command or tool ends. Use `generate` when you need a single model result; a streaming output must be fully consumed or closed explicitly. See [Upgrade and migration](./provider-upgrade.md).

::: details Runtime resilience and credential state constraints

- **Catalog and capability declarations**: a model's name does not prove it supports images, tools, or streaming. Refreshing the catalog is a manual action, and an upstream model ID it returns must still have its capabilities confirmed before joining the usable catalog. One Service can have several Accounts; a failed request never switches to another Account or model automatically.
- **Experimental integrations and protocol details**: Console shows only a short marker for experimental integrations and the necessary notice when you open the details or log in. OpenCode Go and OpenCode Zen are services that each use their own product API key; check plans, models, and applicable scenarios against each product's terms, and do not apply the conditions of the Free product. An Anthropic API key and a Claude subscription, and a Gemini API key and Antigravity, are separate services and authentication identities. After an Antigravity login, the read-only profile and project preparation can be retried on its own without replaying the token exchange that already succeeded. Antigravity has measured evidence of implicit cache hits; this round does not claim native explicit cache CRUD for it. The Google Driver's explicit cache keeps the existing content fingerprint and catalog mechanism; a change of configuration, Account incarnation, model/protocol, or Driver isolates the state, while an ordinary token refresh does not make it switch accounts.
- **Sampling parameters and output limits**: Codex accepts neither temperature nor an output token limit, so its Profile form does not offer those fields; explicitly submitting an unsupported parameter is an error and is not dropped silently. Summaries, ambient listening, and approval no longer write hidden temperature or output limits; the selected Profile decides the parameters. When the generic SDK has no explicit output limit, the existing effective budget applies: the limit the model catalog declares, otherwise 8192. This is an execution default and is never written as an explicit Profile value.
- **Credential expressions and personal connection boundaries**: a Host administrator may enter a single complete `${AI_API_KEY:-default}` or `${AI_API_KEY:=default}` in an Account's "Set API key" password field. The expression is stored only in the private encrypted credential and expanded through the Host environment store only at actual authorization time; personal accounts cannot read the Host environment. The personal management page supports personal API key connections, allowing only public HTTPS targets and same-origin redirects (services the Host itself manages, such as a local Ollama, are not subject to this). Account ownership is decided by the real identity an administrator bound in advance, not by an owner claim in the request body.
- **Import idempotency and state machine**: dictionary keys in an import document are readable aliases, not database account identities. Updating an existing resource uses the explicit bindings the preview provides; a new resource created with the same name after deletion does not inherit the old Account, Session, or private settings. When a result is unknown, keep the mutationId and look it up instead of replaying with a new ID.
- **Structured decisions and SDK version**: structured decisions use `decision` Profiles, selected separately for `skills`, `tools`, `memory`, `agents`, `approval`, and `ambient`; `off` sends no request, `shadow` only records evidence, and only `active` hands the decision to the business module to apply. A plain `evaluate` returns only the real Choice / Score / Noul, never invents a probability, and does not treat a legitimate abstention as a failure. The minimum `ai` version is `^7.0.35`, used for the first-content-chunk timeout.
:::
