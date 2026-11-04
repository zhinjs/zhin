import { openAiProvider } from '../../src/providers/api-key.js';

it('describes the existing effective output budget without materializing a default into an empty Profile', () => {
  for (const declared of [undefined, 12345]) {
    const service = { id: 's', rootId: 'r', ownerId: 'h', revision: 1, driver: { id: openAiProvider.id, owner: 'root', contractVersion: '1' }, options: openAiProvider.serviceSchema.parse({}), models: {} };
    const schema = openAiProvider.profileSchema({ service, model: { id: 'native', protocol: 'openai-chat', kinds: ['language'], ...(declared ? { maxOutputTokens: declared } : {}) } });
    expect(schema.parse({})).not.toHaveProperty('maxOutputTokens');
    expect(schema.inputSchema).toMatchObject({ properties: { maxOutputTokens: { description: expect.stringContaining(String(declared ?? 8192)) } } });
    expect(JSON.stringify(schema.inputSchema)).not.toContain('"default"');
  }
});
