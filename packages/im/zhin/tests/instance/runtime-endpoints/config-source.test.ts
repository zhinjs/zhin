import { describe, expect, it, vi } from 'vitest';
import { childPluginId, createSnapshotView, rootPluginId, type PluginId, type PluginNodeSnapshot } from '@zhin.js/plugin-runtime';
import { createEndpointConfigSource, createEndpointSecretResolver } from '../../../src/instance/runtime-endpoints/config-source.js';

const root = rootPluginId(), owner = childPluginId(root, 'qq');
const snapshot = createSnapshotView(1, { root, tree: new Map<PluginId, PluginNodeSnapshot>([
  [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner] }],
  [owner, { id: owner, parent: root, instanceKey: 'qq', packageName: '@zhin.js/adapter-qq', packageRoot: '/fixture/qq', children: [],
    configSchema: { type: 'object', properties: { mode: { type: 'string', default: 'websocket' }, endpoints: { type: 'array' } } } }],
]), config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map() });

const document = { configVersion: 2, plugins: { qq: '@zhin.js/adapter-qq' }, qq: { endpoints: [{ id: '${QQ_ID}', secret: '${QQ_SECRET}' }] } };

describe('instance endpoint configuration source (#1250)', () => {
  it('reads the stored block with schema defaults and no ${VAR} expansion', async () => {
    const source = createEndpointConfigSource({ read: async () => ({ document, revision: 'rev-1' }), snapshot: () => snapshot,
      patch: vi.fn(), expand: value => value.replace('${QQ_ID}', '10001') });
    await expect(source.read(owner)).resolves.toEqual({ revision: 'rev-1',
      config: { mode: 'websocket', endpoints: [{ id: '${QQ_ID}', secret: '${QQ_SECRET}' }] } });
    expect(source.resolveIdentifier?.('${QQ_ID}')).toBe('10001');
    expect(source.isSecretKey?.('secret')).toBe(true);
    expect(source.isSecretKey?.('mode')).toBe(false);
    await expect(source.read(childPluginId(root, 'unknown'))).resolves.toEqual({ config: undefined, revision: 'rev-1' });
  });

  it('writes <instance>.endpoints with the revision CAS and maps every non-saved outcome to a clear error', async () => {
    const patch = vi.fn()
      .mockResolvedValueOnce({ status: 'saved', revision: 'rev-2', missingEnv: ['QQ_NEW_SECRET'], paths: [], restartRequired: false, message: '' })
      .mockResolvedValueOnce({ status: 'conflict', revision: 'rev-3', current: [], message: '' })
      .mockResolvedValueOnce({ status: 'invalid', revision: 'rev-3', errors: [], missingEnv: [], message: '' })
      .mockResolvedValueOnce({ status: 'unconfirmed', expectedRevision: 'rev-3', message: '' });
    const source = createEndpointConfigSource({ read: async () => ({ document, revision: 'rev-1' }), snapshot: () => snapshot,
      patch, expand: value => value });
    const endpoints = [{ id: 'a', secret: '${QQ_NEW_SECRET}' }];
    await expect(source.writeEndpoints(owner, endpoints, 'rev-1')).resolves.toEqual({ revision: 'rev-2', missingEnv: ['QQ_NEW_SECRET'] });
    expect(patch).toHaveBeenCalledWith({ expectedRevision: 'rev-1', patches: [{ op: 'set', path: ['qq', 'endpoints'], value: endpoints }] });
    await expect(source.writeEndpoints(owner, endpoints, 'rev-1')).rejects.toMatchObject({ code: 'conflict' });
    await expect(source.writeEndpoints(owner, endpoints, 'rev-1')).rejects.toMatchObject({ code: 'invalid_configuration' });
    await expect(source.writeEndpoints(owner, endpoints, 'rev-1')).rejects.toMatchObject({ code: 'commit_unknown' });
  });

  it('resolves references only at start and treats an empty value as a configuration error', async () => {
    const signal = new AbortController().signal;
    const resolver = createEndpointSecretResolver(value => value === '${SET}' ? 'value' : '');
    await expect(resolver.resolve('${SET}', { instanceId: 'a', signal })).resolves.toBe('value');
    await expect(resolver.resolve('${UNSET}', { instanceId: 'a', signal })).rejects.toMatchObject({ code: 'invalid_configuration' });
    await expect(resolver.resolve('literal', { instanceId: 'a', signal })).rejects.toMatchObject({ code: 'invalid_configuration' });
  });
});
