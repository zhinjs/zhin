import '@zhin.js/ai/providers';
import '@zhin.js/service-typesafe';
import { defineAIPlan } from '@zhin.js/ai/provider';

defineAIPlan({ version: 1, services: {
  codex: { driver: 'codex-subscription' }, claude: { driver: 'claude-subscription' },
  key: { driver: 'openai' }, decision: { driver: 'typesafe' }, go: { driver: 'opencode-go' },
}, accounts: {
  codex: { service: 'codex', auth: { method: 'oauth' } }, claude: { service: 'claude', auth: { method: 'oauth' } },
  key: { service: 'key', auth: { method: 'api-key', source: 'env://MODEL_KEY' } },
  decision: { service: 'decision', auth: { method: 'api-key' } }, go: { service: 'go', auth: { method: 'api-key' } },
}, profiles: { chat: { account: 'key', model: 'native-id', parameters: { maxOutputTokens: 123 } },
  judge: { account: 'decision', model: 'jev', parameters: { timeoutMs: 500 } } } });

defineAIPlan({ version: 1, services: { product: { driver: 'codex-subscription' } },
  // @ts-expect-error real Codex product never declares API-key authentication
  accounts: { account: { service: 'product', auth: { method: 'api-key' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: 'codex-subscription' } },
  // @ts-expect-error real Codex product never declares unauthenticated inference
  accounts: { account: { service: 'product', auth: { method: 'none' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: 'openai' } },
  // @ts-expect-error API-key Provider is not a subscription OAuth product
  accounts: { account: { service: 'product', auth: { method: 'oauth' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: 'typesafe' } },
  // @ts-expect-error TypeSafe accepts API keys, not OAuth
  accounts: { account: { service: 'product', auth: { method: 'oauth' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: 'opencode-go' } },
  // @ts-expect-error OpenCode Go uses its product API key
  accounts: { account: { service: 'product', auth: { method: 'oauth' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: 'typesafe' } },
  accounts: { account: { service: 'product', auth: { method: 'api-key' } } },
  // @ts-expect-error real TypeSafe parameter schema does not expose language temperature
  profiles: { invalid: { account: 'account', model: 'jev', parameters: { temperature: 1 } } } });

defineAIPlan({ version: 1, services: { product: { driver: { id: 'codex-subscription', owner: 'root/subscription', contractVersion: '1' } } },
  accounts: { own: { service: 'product', auth: { method: 'oauth' } } }, profiles: {} });
defineAIPlan({ version: 1, services: { product: { driver: { id: 'typesafe', owner: 'root/decision', contractVersion: '1' } } },
  // @ts-expect-error exact owner selection preserves the real Driver authentication method inference
  accounts: { own: { service: 'product', auth: { method: 'oauth' } } }, profiles: {} });
defineAIPlan({ version: 1,
  // @ts-expect-error exact Driver references must contain the contract version
  services: { product: { driver: { id: 'codex-subscription', owner: 'root/subscription' } } }, accounts: {}, profiles: {} });


defineAIPlan({ version: 1, services: { product: { driver: 'codex-subscription' } },
  accounts: { account: { service: 'product', auth: { method: 'oauth' } } },
  // @ts-expect-error the real Codex Profile schema excludes sampling temperature
  profiles: { invalid: { account: 'account', model: 'native-id', parameters: { temperature: 0.1 } } } });
defineAIPlan({ version: 1, services: { product: { driver: 'codex-subscription' } },
  accounts: { account: { service: 'product', auth: { method: 'oauth' } } },
  // @ts-expect-error the real Codex Profile schema excludes output token limits
  profiles: { invalid: { account: 'account', model: 'native-id', parameters: { maxOutputTokens: 100 } } } });
