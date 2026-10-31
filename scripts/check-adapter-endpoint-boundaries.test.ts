import { usesSupportedAdapterBase, declaresAdapterTypeRegistry } from './lib/adapter-authoring-contract.mjs';

it('permits the generic Adapter base only from its subpath and rejects removed factories', () => {
  expect(usesSupportedAdapterBase("import { Adapter } from 'zhin.js/adapter'; class IcqqAdapter extends Adapter<Endpoint, Config, Events> {} ")).toBe(true);
  expect(usesSupportedAdapterBase("import { Adapter } from '@zhin.js/adapter'; class Platform extends Adapter {} ")).toBe(true);
  expect(usesSupportedAdapterBase("export default defineAdapter({ createAdapter: () => new NativeAdapter() })")).toBe(true);
  expect(usesSupportedAdapterBase("export default defineAdapter({ create: () => new LegacyEndpoint() })")).toBe(false);
  expect(usesSupportedAdapterBase("defineAdapter<Config>({ createAdapter: () => new NativeAdapter(), create() {} })")).toBe(false);
  expect(usesSupportedAdapterBase("defineAdapter({ createAdapter: () => new NativeAdapter(service.create()) })")).toBe(true);
  expect(usesSupportedAdapterBase("import { Adapter } from 'zhin.js'; class IcqqAdapter extends Adapter {} ")).toBe(false);
  expect(usesSupportedAdapterBase("import { Adapter } from '@zhin.js/core'; class IcqqAdapter extends Adapter {} ")).toBe(false);
  expect(usesSupportedAdapterBase('class IcqqAdapter extends Adapter {}')).toBe(false);
});
it('requires the single actual Adapter registry without a legacy descriptor branch', () => {
  expect(declaresAdapterTypeRegistry("declare module '@zhin.js/feature-kit' { interface AdapterRegistry { icqq: IcqqAdapter } }")).toBe(true);
  expect(declaresAdapterTypeRegistry('interface AdapterClientRegistry { qq: ClientTypes }')).toBe(false);
  expect(declaresAdapterTypeRegistry('interface AdapterRegistry {} interface AdapterClientRegistry {}')).toBe(false);
  expect(declaresAdapterTypeRegistry('interface UnrelatedRegistry {}')).toBe(false);
  expect(declaresAdapterTypeRegistry("declare module 'zhin.js/adapter' { interface AdapterRegistry { icqq: IcqqAdapter } }")).toBe(false);
  expect(declaresAdapterTypeRegistry("declare module '@zhin.js/adapter' { interface AdapterRegistry { icqq: IcqqAdapter } }")).toBe(false);
});
