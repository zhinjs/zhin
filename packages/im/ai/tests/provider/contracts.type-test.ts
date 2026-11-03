import {
  defineProvider, defineAIPlan,
  type InferenceClient, type ModelProfile, type ProviderService,
} from '@zhin.js/ai/provider';

const driver = defineProvider({
  id: 'typed-fixture', contractVersion: '1',
  serviceSchema: { parse: (_value: unknown): { region: string } => ({ region: 'test' }) },
  profileSchema: () => ({ parse: (_value: unknown): { temperature: number } => ({ temperature: 0.5 }) }),
  authentication: { methods: ['none'] as const },
  targets: (_service: ProviderService<{ region: string }>) => ({ authentication: [], inference: ['https://example.test'] }),
  models: (service: ProviderService<{ region: string }>) => service.models,
  createExecution(options) {
    const profile: ModelProfile<{ temperature: number }> = options.binding.profile;
    const temperature: number = profile.parameters.temperature;
    void temperature;
    return {};
  },
});

declare module '@zhin.js/ai/provider' { interface AIProviderRegistry { 'typed-fixture': typeof driver } }

defineAIPlan({ version: 1, services: { local: { driver: 'typed-fixture', options: { region: 'test' } } },
  accounts: { own: { service: 'local', auth: { method: 'none' } } },
  profiles: { daily: { account: 'own', model: 'native-id', parameters: { temperature: 0.5 } } } });

defineAIPlan({ version: 1, services: { local: { driver: 'typed-fixture' } },
  // @ts-expect-error authentication derives from the actual driver's literal methods
  accounts: { own: { service: 'local', auth: { method: 'oauth' } } }, profiles: {} });

defineAIPlan({ version: 1,
  // @ts-expect-error service options are inferred from the registered driver's schema
  services: { local: { driver: 'typed-fixture', options: { unrelated: true } } }, accounts: {}, profiles: {} });

declare const client: InferenceClient;
const language = (await client.list({ kind: 'language' }))[0].reference;
const decision = (await client.list({ kind: 'decision' }))[0].reference;
const image = (await client.list({ kind: 'image' }))[0].reference;
await client.generate({ profile: language, request: { context: { systemPrompt: '', messages: [] } } });
await client.generateImage({ profile: image, request: { prompt: 'synthetic' } });
const evidence = await client.evaluate({ profile: decision, state: null, questions: {
  pick: { type: 'choice', criteria: { yes: 'yes', no: 'no' } }, truth: { type: 'noul' },
} });
const choice: 'yes' | 'no' = evidence.answers.pick.choice;
const probability: number = evidence.answers.truth.noul;
void choice; void probability;
// @ts-expect-error language references are not decision models
await client.evaluate({ profile: language, state: null, questions: {} });
// @ts-expect-error decision references are not image models
await client.generateImage({ profile: decision, request: { prompt: 'synthetic' } });
// @ts-expect-error inference evidence does not assert that business policy was applied
void evidence.applied;
