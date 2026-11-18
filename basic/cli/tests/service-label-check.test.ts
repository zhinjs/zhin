import { checkGenericServiceLabels, genericServiceLabels, isGenericServiceLabel } from '../src/utils/service-label-check.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

// #1250 account-add-service-label-generic: older `zhin ai account add` stored the plan alias `service` as the label.
const view = {
  services: {
    'services:1': { id: 'services:1', label: 'service', driver: { id: 'anthropic' } },
    'services:2': { id: 'services:2', label: 'Anthropic', driver: { id: 'anthropic' } },
    'services:3': { id: 'services:3', label: 'Service', driver: { id: 'custom' } },
  },
  drivers: [{ id: 'anthropic', label: 'Anthropic' }],
};

it('recognizes only the generic plan aliases as generic labels', () => {
  expect(isGenericServiceLabel('service')).toBe(true);
  expect(isGenericServiceLabel(' Service ')).toBe(true);
  expect(isGenericServiceLabel('Anthropic')).toBe(false);
  expect(isGenericServiceLabel('my service')).toBe(false);
  expect(isGenericServiceLabel(undefined)).toBe(false);
});

it('lists the generic services with the driver display name as the suggestion, never a name already taken', () => {
  // services:2 is already named "Anthropic": the suggestion for services:1 is numbered.
  expect(genericServiceLabels(view)).toEqual([
    { id: 'services:1', label: 'service', suggestion: 'Anthropic 2' },
    { id: 'services:3', label: 'Service', suggestion: 'custom' },
  ]);
});

it('never suggests the same name twice (#1250)', () => {
  expect(genericServiceLabels({
    services: {
      'services:a': { id: 'services:a', label: 'service', driver: { id: 'anthropic' } },
      'services:b': { id: 'services:b', label: 'service', driver: { id: 'anthropic' } },
      'services:c': { id: 'services:c', label: 'anthropic 2', driver: { id: 'anthropic' } },
    },
    drivers: [{ id: 'anthropic', label: 'Anthropic' }],
  }).map(entry => entry.suggestion)).toEqual(['Anthropic', 'Anthropic 3']);
});

it('reports one warning with the Console entry, reading the view over the local socket', async () => {
  const paths: string[] = [];
  const client: HostHttpConfig = {
    baseUrl: 'http://gateway.local/api/agent/inference', token: '',
    fetch: async (input) => {
      paths.push(new URL(String(input)).pathname);
      return new Response(JSON.stringify({ success: true, data: view }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const results = await checkGenericServiceLabels({ client });
  expect(paths).toEqual(['/api/agent/inference']);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: 'warn', name: '模型服务名称' });
  expect(results[0]!.message).toContain('services:1');
  expect(results[0]!.message).toContain('Anthropic');
  expect(results[0]!.fix).toContain('Console「模型」');
});

it('says nothing when no service is generic or the instance is not reachable', async () => {
  expect(await checkGenericServiceLabels({ client: undefined })).toEqual([]);
  expect(await checkGenericServiceLabels({ client: undefined, view: { services: { a: { label: 'OpenAI' } } } })).toEqual([]);
});
