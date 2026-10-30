import { usesSupportedAdapterBase, declaresAdapterTypeRegistry } from './lib/adapter-authoring-contract.mjs';

it('permits the approved generic Adapter base only from the Adapter subpath, while retaining defineAdapter compatibility', () => {
  expect(usesSupportedAdapterBase("import { Adapter } from 'zhin.js/adapter'; class IcqqAdapter extends Adapter<Endpoint, Config, Events> {} ")).toBe(true);
  expect(usesSupportedAdapterBase("import { Adapter } from '@zhin.js/adapter'; class Platform extends Adapter {} ")).toBe(true);
  expect(usesSupportedAdapterBase("export default defineAdapter({ create: () => new LegacyEndpoint() })")).toBe(true);
  expect(usesSupportedAdapterBase("import { Adapter } from 'zhin.js'; class IcqqAdapter extends Adapter {} ")).toBe(false);
  expect(usesSupportedAdapterBase("import { Adapter } from '@zhin.js/core'; class IcqqAdapter extends Adapter {} ")).toBe(false);
  expect(usesSupportedAdapterBase('class IcqqAdapter extends Adapter {}')).toBe(false);
});
it('accepts the canonical Adapter registry and legacy Client registry without allowing an unregistered platform', () => {
  expect(declaresAdapterTypeRegistry('interface AdapterRegistry { icqq: IcqqAdapter }')).toBe(true);
  expect(declaresAdapterTypeRegistry('interface AdapterClientRegistry { qq: ClientTypes }')).toBe(true);
  expect(declaresAdapterTypeRegistry('interface UnrelatedRegistry {}')).toBe(false);
});
