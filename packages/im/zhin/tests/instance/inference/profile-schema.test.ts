import { z } from 'zod';
import { setupInferenceManagement } from './fixtures.js';

it('normalizes the real held Driver parameters into the reviewed SQLite graph and rechecks them on apply', async () => {
  const fixture = await setupInferenceManagement();
  const parameters = z.strictObject({ temperature: z.number().default(0.25) });
  fixture.definition.profileSchema = ({ model }) => {
    if (!model.kinds.includes('language')) throw new Error('synthetic unsupported model');
    return { inputSchema: z.toJSONSchema(parameters), parse: (input) => parameters.parse(input) };
  };
  try {
    const change = await fixture.management.review(fixture.principal, {
      plan: { version: 1, profiles: { profile: { account: 'account', model: 'example', parameters: {} } } },
      bindings: { accounts: { account: 'account' }, profiles: { profile: 'profile' } },
    });
    expect(change.changes?.profiles.updated).toEqual(['profile']);
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: change.prepared,
        mutationId: 'normalized',
      })
    ).toMatchObject({ status: 'committed' });
    expect((await fixture.repository.readGraph({ rootId: '/root' }))!.profiles.profile.parameters).toEqual({
      temperature: 0.25,
    });
    await expect(
      fixture.management.review(fixture.principal, {
        plan: {
          version: 1,
          profiles: {
            profile: { account: 'account', model: 'example', parameters: { imageGeneration: {} } },
          },
        },
        bindings: { accounts: { account: 'account' }, profiles: { profile: 'profile' } },
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect((await fixture.repository.readGraph({ rootId: '/root' }))!.revision).toBe(2);
  } finally {
    await fixture.close();
  }
});

it('validates newly bound existing Profiles and changed model declarations without credential or provider access', async () => {
  const fixture = await setupInferenceManagement();
  const parse = vi.fn((input: unknown) =>
    z.strictObject({ maxOutputTokens: z.number().default(20) }).parse(input)
  );
  fixture.definition.profileSchema = ({ model }) => ({
    inputSchema: { type: 'object', properties: { maxOutputTokens: { type: 'number' } } },
    parse,
  });
  try {
    const schema = await fixture.management.profileSchema(fixture.principal, {
      accountId: 'account',
      model: { id: 'new-native', kinds: ['language'], protocol: 'fixture', input: ['text'] },
    });
    expect(schema).toMatchObject({ model: { id: 'new-native' }, inputSchema: { type: 'object' } });
    expect(parse).not.toHaveBeenCalled();
    const purpose = await fixture.management.review(fixture.principal, {
      plan: { version: 1, purposes: { summary: { profile: 'profile' } } },
      bindings: { profiles: { profile: 'profile' } },
    });
    expect(purpose.changes?.profiles.updated).toEqual(['profile']);
    expect(
      await fixture.management.apply(fixture.principal, {
        prepared: purpose.prepared,
        mutationId: 'new-purpose',
      })
    ).toMatchObject({ status: 'committed' });
    expect((await fixture.repository.readGraph({ rootId: '/root' }))!.profiles.profile.parameters).toEqual({
      maxOutputTokens: 20,
    });
    expect(fixture.exchange).not.toHaveBeenCalled();
    await expect(
      fixture.management.profileSchema(
        { ownerId: 'other', hostAdministrator: false },
        { accountId: 'account', model: fixture.graph.services.service.models.example }
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
  } finally {
    await fixture.close();
  }
});
