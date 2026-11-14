import Ajv from 'ajv';
import { builtinAiProviders, googleProvider, openAiProvider, openAiCompatibleProvider, codexProvider, antigravityProvider } from '../../src/providers/index.js';

const ajv = new Ajv({ strict: false, validateFormats: false });
it.each(builtinAiProviders.map(definition => ({ definition, id: definition.id })))(
  'keeps $id Service and Profile descriptions aligned with actual structural input parsing', ({ definition }) => {
    const options = definition.id === 'cloudflare' ? { accountId: 'synthetic' }
      : definition.id === 'openai-compatible' ? { baseUrl: 'https://synthetic.example/v1' } : {};
    expect(definition.label).toBeTruthy(); expect(definition.modelContracts!.length).toBeGreaterThan(0);
    const service = ajv.compile(definition.serviceSchema.inputSchema!);
    expect(service(options)).toBe(true); expect(() => definition.serviceSchema.parse(options)).not.toThrow();
    const bad = { ...options, unknownField: 'extra' };
    expect(service(bad)).toBe(false); expect(() => definition.serviceSchema.parse(bad)).toThrow();
    const contract = definition.modelContracts![0];
    const profile = definition.profileSchema!({ service: { id: 'service', rootId: 'root', ownerId: 'host', revision: 1,
      driver: { id: definition.id, owner: 'root', contractVersion: '1' }, options: definition.serviceSchema.parse(options), models: {} },
      model: { id: 'synthetic', protocol: contract.protocol, kinds: contract.kinds, thinking: true, streaming: true } });
    const parameters = ajv.compile(profile.inputSchema!);
    for (const input of [{}, { maxRetries: 0, requestTimeoutMs: 1000, firstChunkTimeoutMs: 200, chunkTimeoutMs: 300 }]) {
      expect(parameters(input)).toBe(true); expect(() => profile.parse(input)).not.toThrow();
    }
    for (const input of [{ maxRetries: -1 }, { firstChunkTimeoutMs: 2.5 }, { compat: {} }, { providerOptions: {} }]) {
      expect(parameters(input)).toBe(false); expect(() => profile.parse(input)).toThrow();
    }
  });

it('describes fixed subscription products separately and rejects unsupported Codex generation controls structurally', () => {
  const profile = codexProvider.profileSchema({ service: { id: 'service', rootId: 'root', ownerId: 'host', revision: 1,
    driver: { id: codexProvider.id, owner: 'root', contractVersion: '1' }, options: codexProvider.serviceSchema.parse({}), models: {} },
    model: { id: 'selected', kinds: ['language'], protocol: 'codex-responses' } });
  const validate = ajv.compile(profile.inputSchema!);
  for (const input of [{ temperature: 1 }, { maxOutputTokens: 10 }, { safetySettings: [] }]) {
    expect(validate(input)).toBe(false); expect(() => profile.parse(input)).toThrow('unsupported-parameter');
  }
  expect(() => codexProvider.serviceSchema.parse({ baseUrl: 'https://other.example' })).toThrow();
});

it('accepts an optional string Google Cloud project id for Antigravity and a Codex CLI client version, described for the Console', () => {
  expect(antigravityProvider.serviceSchema.parse({ projectId: ' my-project-123 ' })).toMatchObject({ projectId: 'my-project-123' });
  expect(antigravityProvider.serviceSchema.parse({})).not.toHaveProperty('projectId');
  // The numeric project number, uppercase or too-short ids are not project ids.
  for (const invalid of ['123456789012', 'My-Project', 'abc', '', 'project/../x']) expect(() => antigravityProvider.serviceSchema.parse({ projectId: invalid })).toThrow();
  expect(antigravityProvider.serviceSchema.inputSchema).toMatchObject({ properties: { projectId: { type: 'string' } } });
  expect(codexProvider.serviceSchema.parse({ codexClientVersion: '0.167.0' })).toMatchObject({ codexClientVersion: '0.167.0' });
  expect(codexProvider.serviceSchema.inputSchema).toMatchObject({ properties: { codexClientVersion: { type: 'string' } } });
});

it.each(['authorization', 'x-api-key', 'x-goog-api-key', 'x-auth-token', 'cf-access-client-secret', 'proxy-authorization', 'cookie'])(
  'rejects the credential header %s before it can enter public Service metadata', header => {
    for (const definition of [openAiProvider, googleProvider, openAiCompatibleProvider]) {
      expect(() => definition.serviceSchema.parse({ baseUrl: 'https://synthetic.example/v1', headers: { [header]: 'synthetic-secret' } })).toThrow('belong in the account');
    }
  });

it.each(['api_key', 'x-goog-api-key', 'access_token', 'cf-access-client-secret'])(
  'rejects credential URL parameter %s while retaining ordinary parameters and headers', key => {
    expect(() => openAiProvider.serviceSchema.parse({ baseUrl: `https://synthetic.example/v1?${key}=synthetic-secret` })).toThrow('belong in the account');
    expect(openAiProvider.serviceSchema.parse({ baseUrl: 'https://synthetic.example/v1?region=asia', headers: { 'x-request-id': 'synthetic', 'anthropic-version': '2023-06-01' } }))
      .toMatchObject({ baseUrl: 'https://synthetic.example/v1?region=asia', headers: { 'x-request-id': 'synthetic', 'anthropic-version': '2023-06-01' } });
  });

it('keeps protocol/cache tuning out of real Service authentication identity', () => {
  const base = { id: 'service', rootId: 'root', ownerId: 'host', revision: 1, driver: { id: 'google', owner: 'root', contractVersion: '1' }, models: {} };
  const initial = { ...base, options: googleProvider.serviceSchema.parse({}) };
  const tuning = { ...base, options: googleProvider.serviceSchema.parse({ compat: { structuredOutput: 'prompt' }, contextCache: { mode: 'explicit', ttlSeconds: 3600 } }) };
  expect(googleProvider.identity!(initial)).toEqual(googleProvider.identity!(tuning));
  expect(googleProvider.identity!({ ...base, options: googleProvider.serviceSchema.parse({ baseUrl: 'https://other.example/v1beta' }) }))
    .not.toEqual(googleProvider.identity!(initial));
});

it.each(builtinAiProviders.flatMap(definition => definition.modelContracts!.map(contract => ({ definition, contract, id: `${definition.id}/${contract.protocol}` }))))(
  'uses one actual-model schema for $id persistence, Console description and execution', ({ definition, contract }) => {
    const options = definition.id === 'cloudflare' ? { accountId: 'synthetic' } : definition.id === 'openai-compatible' ? { baseUrl: 'https://synthetic.example/v1' } : {};
    const service = { id: 'service', rootId: 'root', ownerId: 'host', revision: 1, driver: { id: definition.id, owner: 'root', contractVersion: '1' },
      options: definition.serviceSchema.parse(options), models: {} };
    const model = { id: 'image-01', protocol: contract.protocol, kinds: contract.kinds, thinking: false };
    const schema = definition.profileSchema!({ service, model }), validate = ajv.compile(schema.inputSchema!);
    expect(validate({})).toBe(true); expect(() => schema.parse({})).not.toThrow();
    const invalid: unknown[] = contract.kinds.includes('language') ? [{ imageGeneration: { promptSuffix: 'image-only' } }, { thinkingLevel: 'high' }]
      : [{ temperature: 0.2 }, { maxOutputTokens: 10 }, { thinkingLevel: 'off' }, { chunkTimeoutMs: 500 }, { safetySettings: [] }];
    if (contract.protocol !== 'google-generate-content' && contract.protocol !== 'antigravity-generate-content') invalid.push({ safetySettings: [] });
    const validImage = contract.protocol === 'google-images' || contract.protocol === 'antigravity-images' ? { imageSize: '2K', aspectRatio: '16:9' }
      : contract.protocol === 'cloudflare-images' ? { numSteps: 4 } : contract.protocol === 'minimax-images' ? { defaultSize: '512x512', aspectRatio: '1:1' }
        : { defaultSize: '512x512', quality: 'high', background: 'transparent' };
    if (contract.kinds.includes('image')) {
      expect(validate({ imageGeneration: validImage })).toBe(true); expect(() => schema.parse({ imageGeneration: validImage })).not.toThrow();
      if (contract.protocol !== 'openai-images' || definition.id !== 'openai-compatible') invalid.push({ imageGeneration: { watermarkEnabled: true } });
    }
    for (const value of invalid) { expect(validate(value)).toBe(false); expect(() => schema.parse(value)).toThrow(); }
  });
