import type { CredentialGrant, CredentialPort, ProviderAccount, ProviderService } from '@zhin.js/ai/provider';
import {
  createCredentialRequestAccess,
  type CredentialTransportFact,
} from '../../../src/plugin-runtime/inference/request-access.js';
import { createProviderNetwork } from '../../../src/plugin-runtime/inference/network.js';
import { createPersonalModelFetch } from '../../../src/plugin-runtime/inference/personal-network.js';

const account: ProviderAccount = {
  id: 'a',
  rootId: '/r',
  ownerId: 'host',
  revision: 1,
  serviceId: 's',
  incarnation: 'i',
  authentication: { method: 'api-key' },
};
const service: ProviderService = {
  id: 's',
  rootId: '/r',
  ownerId: 'host',
  revision: 1,
  driver: { id: 'fixture', owner: 'root', contractVersion: '1' },
  options: {},
  models: {},
};
function setup(
  options: {
    beforeSubmit?: () => void;
    observe?: (fact: CredentialTransportFact) => void | Promise<void>;
    personal?: boolean;
    deniedDns?: boolean;
  } = {}
) {
  const facts: CredentialTransportFact[] = [];
  let revision = '1';
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const port: CredentialPort = {
    authorize: async () => ({ token: 'synthetic-secret', headers: {}, revision }),
    bindRequest: ({ request }) => request,
  };
  const access = createCredentialRequestAccess({
    account,
    service,
    credentials: port,
    authenticationContract: 'auth-1',
    beforeSubmit: options.beforeSubmit,
    observe: (fact) => {
      facts.push(fact);
      return options.observe?.(fact);
    },
    network: (beforeSubmit) =>
      options.personal
        ? createPersonalModelFetch({
            baseUrl: 'https://fixture.invalid',
            beforeSubmit,
            lookup: async () => [{ address: options.deniedDns ? '127.0.0.1' : '8.8.8.8', family: 4 }],
            transport: async ({ request }) => transport(request),
          })
        : createProviderNetwork({
            account,
            service,
            hostOwnerId: 'host',
            purpose: 'inference',
            beforeSubmit,
            hostFetch: transport,
            definition: {
              id: 'fixture',
              contractVersion: '1',
              serviceSchema: { parse: (value) => value },
              models: () => ({}),
              authentication: { methods: ['api-key'] },
              targets: () => ({ authentication: [], inference: ['https://fixture.invalid/v1'] }),
              createExecution: vi.fn(),
            },
          }),
  });
  async function request(path = '/v1/chat') {
    const target = new URL(path, 'https://fixture.invalid');
    const grant = await access.credentials.authorize({ target, signal: new AbortController().signal });
    return access.credentials.bindRequest({
      grant,
      request: new Request(target, { headers: { authorization: `Bearer ${grant.token}` } }),
    });
  }
  return {
    ...access,
    facts,
    transport,
    request,
    setRevision(value: string) {
      revision = value;
    },
  };
}
it('binds only original issued grants and unchanged final Requests; unsubmitted work has no attempted evidence', async () => {
  const f = setup(),
    request = await f.request();
  expect(f.facts).toEqual([]);
  expect(() =>
    f.credentials.bindRequest({ grant: { headers: {}, revision: '1' } satisfies CredentialGrant, request })
  ).toThrow();
  await expect(f.fetch(request, { headers: {} })).rejects.toMatchObject({ code: 'target-denied' });
  await expect(f.fetch(new Request(request))).rejects.toMatchObject({ code: 'target-denied' });
  await expect(f.fetch(await f.request('/not-allowed'))).rejects.toMatchObject({ code: 'target-denied' });
  expect(f.facts).toEqual([]);
  expect(f.transport).not.toHaveBeenCalled();
  await f.fetch(request, { signal: new AbortController().signal });
  expect(f.facts.map((fact) => [fact.phase, fact.credentialRevision])).toEqual([
    ['transport-attempted', '1'],
    ['response', '1'],
  ]);
  expect(JSON.stringify(f.facts)).not.toMatch(/synthetic-secret|authorization|fixture.invalid/);
});
it('records after quota and personal DNS admission, preserving business rejections without any submission fact', async () => {
  const denied = new Error('synthetic quota denial'),
    quota = setup({
      beforeSubmit: () => {
        throw denied;
      },
    });
  await expect(quota.fetch(await quota.request())).rejects.toBe(denied);
  expect(quota.facts).toEqual([]);
  expect(quota.transport).not.toHaveBeenCalled();
  const personal = setup({ personal: true, deniedDns: true });
  await expect(personal.fetch(await personal.request())).rejects.toMatchObject({ code: 'denied' });
  expect(personal.facts).toEqual([]);
  expect(personal.transport).not.toHaveBeenCalled();
});
it('keeps concurrent versions and late old responses distinct without replaying or changing credentials', async () => {
  const f = setup(),
    old = await f.request();
  f.setRevision('2');
  const current = await f.request();
  let finishOld!: (response: Response) => void;
  f.transport
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce(new Response('{}'));
  const oldResult = f.fetch(old);
  await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1));
  await f.fetch(current);
  finishOld(new Response('{}', { status: 401 }));
  expect((await oldResult).status).toBe(401);
  expect(f.facts.map((fact) => [fact.phase, fact.credentialRevision, fact.status])).toEqual([
    ['transport-attempted', '1', undefined],
    ['transport-attempted', '2', undefined],
    ['response', '2', 200],
    ['response', '1', 401],
  ]);
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(
    (
      await f.credentials.authorize({
        target: new URL('https://fixture.invalid/v1/chat'),
        signal: new AbortController().signal,
      })
    ).revision
  ).toBe('2');
});
it('does not turn private observer failures into transport or credential failures', async () => {
  const f = setup({
    observe: () => {
      throw new Error('synthetic observer failure');
    },
  });
  expect((await f.fetch(await f.request())).status).toBe(200);
  expect(f.transport).toHaveBeenCalledOnce();
});

it('isolates a rejecting asynchronous observer without awaiting it or changing the original transport failure', async () => {
  const f = setup({
    observe: async () => {
      throw new Error('synthetic asynchronous observer failure');
    },
  });
  expect((await f.fetch(await f.request())).status).toBe(200);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.transport.mockRejectedValueOnce(new Error('synthetic transport failure'));
  await expect(f.fetch(await f.request())).rejects.toMatchObject({ code: 'transport' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.transport).toHaveBeenCalledTimes(2);
});
