import { describe, expect, it, vi } from 'vitest';
import { CommandIndex, commandFeatureId, defineCommand, parseCommandDefinition } from '@zhin.js/command';
import { createCapabilitySlot, outboundHostToken } from '@zhin.js/plugin-runtime';
import { AdapterManagementError } from '../src/index.js';
import { createDurableEndpointCommandReply, createEndpointCommands, endpointCommandForbidden, extractEndpointCommandReply,
  formatEndpointList, isEndpointOperator, type EndpointCommandUse, type EndpointCommandsSpec } from '../src/endpoint-commands.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

const demoSpec: EndpointCommandsSpec = { adapterKey: 'demo', adapterDisplayName: 'Demo',
  fields: [{ key: 'token', required: true, env: true, description: 'bot token', descriptionI18n: { en: 'Bot token' } }, { key: 'baseUrl', description: 'API base URL' }],
  describeEntry: entry => `token: ${String(entry.token)}` };

describe('isEndpointOperator', () => {
  const message = (sender: string) => ({ sender: { id: sender } });

  it('未配置 master 时放行', () => {
    expect(isEndpointOperator({}, message('alice'))).toBe(true);
    expect(isEndpointOperator({ endpoints: [{ id: 'a' }] }, message('alice'))).toBe(true);
    expect(isEndpointOperator(undefined, undefined)).toBe(true);
  });

  it('顶层 master 命中放行，不命中拒绝', () => {
    const config = { master: '1659488338' };
    expect(isEndpointOperator(config, message('1659488338'))).toBe(true);
    expect(isEndpointOperator(config, message('8596238'))).toBe(false);
  });

  it('endpoints[i].master 逐项命中同样放行', () => {
    const config = { endpoints: [{ id: 'a', master: 8596238 }] };
    expect(isEndpointOperator(config, message('8596238'))).toBe(true);
    expect(isEndpointOperator(config, message('111'))).toBe(false);
  });

  it('sender 缺失时拒绝（已配置 master）', () => {
    expect(isEndpointOperator({ master: '1' }, {})).toBe(false);
    expect(isEndpointOperator({ master: '1' }, undefined)).toBe(false);
  });
});

describe('extractEndpointCommandReply', () => {
  it('从消息 input 提取 $reply；非消息输入降级 no-op', async () => {
    const calls: string[] = [];
    const message = { $reply: async (content: string) => void calls.push(content) };

    const reply = extractEndpointCommandReply(message);
    await reply('hello');
    expect(calls).toEqual(['hello']);

    await expect(extractEndpointCommandReply(undefined)('x')).resolves.toBeUndefined();
    await expect(extractEndpointCommandReply({})('x')).resolves.toBeUndefined();
  });
});

describe('createDurableEndpointCommandReply', () => {
  it('有 conversation 时优先走 OutboundHost，不调用已过期的 $reply', async () => {
    const sent: unknown[] = [];
    const outbound = {
      send: async (input: unknown) => {
        sent.push(input);
        return 'mid-1';
      },
    };
    const use = ((token: { id: string }) => {
      if (token === outboundHostToken || token.id === outboundHostToken.id) return outbound;
      throw new Error(`unexpected token ${token.id}`);
    }) as EndpointCommandUse;

    const reply = createDurableEndpointCommandReply({
      conversation: {
        endpoint: { id: 'cap-icqq', adapter: 'root/icqq' },
        kind: 'group',
        id: '129043431',
      },
      metadata: { endpoint: '210723495' },
      $reply: async () => {
        throw new Error('Message reply scope has ended');
      },
    }, use);

    await expect(reply('绑定成功')).resolves.toBeUndefined();
    expect(sent).toEqual([{
      adapter: 'root/icqq',
      endpointKey: '210723495',
      conversation: { kind: 'group', id: '129043431' },
      content: '绑定成功',
    }]);
  });

  it('无 OutboundHost 时回退 scoped $reply', async () => {
    const calls: string[] = [];
    const use = (() => {
      throw new Error('missing outbound');
    }) as EndpointCommandUse;
    const reply = createDurableEndpointCommandReply({
      conversation: {
        endpoint: { id: 'cap', adapter: 'root/icqq' },
        kind: 'private',
        id: 'u1',
      },
      $reply: async (content: string) => void calls.push(content),
    }, use);
    await reply('hi');
    expect(calls).toEqual(['hi']);
  });
});

describe('formatEndpointList', () => {
  it('运行中 + 配置中两段，空列表占位，footer 追加', () => {
    const text = formatEndpointList(demoSpec, {
      running: [{ id: 'run-bot', mode: 'ws' }, { id: 'no-mode' }],
      configured: [{ id: 'conf-bot', token: '••••••' }],
      footer: '⚠️ 提示行',
    });

    expect(text).toContain('【运行中的 Demo endpoints】');
    expect(text).toContain('  - run-bot（ws）');
    expect(text).toContain('  - no-mode\n');
    expect(text).toContain('Demo 持久账号配置');
    expect(text).toContain('  - conf-bot（token: ••••••）');
    expect(text.endsWith('⚠️ 提示行')).toBe(true);
  });

  it('空列表占位提示', () => {
    const text = formatEndpointList(demoSpec, {
      running: [],
      configured: [],
    });
    expect(text.match(/（无）/g)).toHaveLength(2);
  });
});


describe('createEndpointCommands uses actual owned Adapter persistence', () => {
  it('produces all three valid convention definitions', () => {
    const commands = createEndpointCommands(demoSpec, defineCommand);
    for (const definition of [commands.list, commands.add, commands.remove]) expect(() => parseCommandDefinition(definition)).not.toThrow();
  });
  it('dispatches the actual CommandIndex route into one CAS, preserves the whole value after the first equals, and leaves source/env and process unchanged', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand), pid = process.pid;
    const slot = createCapabilitySlot({ owner: f.owner, feature: commandFeatureId, localName: 'demo/endpoint/add/$id', source: '/fixture/commands/demo/endpoint/add/[id]/index.ts',
      definition: { ...commands.add, $parameter: { name: 'id', type: 'string' } as const } });
    const snapshot = { ...f.store.current, capabilities: new Map([...f.store.current.capabilities, [slot.id, slot]]) };
    const commandIndex = new CommandIndex([slot], snapshot);
    expect(await commandIndex.dispatch('demo endpoint add bot token=a=b=c baseUrl=https://fixture.invalid', { sender: { id: 'alice' } })).toMatchObject({ status: 'executed', value: expect.stringContaining('尚未启动') });
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1);
    expect(f.repository.state.get(f.adapter.descriptor.id)!.endpoints[0]).toMatchObject({ endpointId: 'bot', desiredEnabled: false, config: { id: 'bot', token: 'a=b=c', baseUrl: 'https://fixture.invalid' } });
    expect(f.adapter.created).toHaveLength(0); expect(f.source).toEqual({ endpoints: [] }); expect(f.use).not.toHaveBeenCalled(); expect(f.store.current.generation).toBe(0); expect(process.pid).toBe(pid);
  });
  it('lists running and persisted rows from the same directory without permitting a second runtime Map or exposing credentials', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand);
    await commands.add.execute(f.commandContext({ params: { id: 'conf' }, args: ['token=synthetic-secret'] }));
    const row = f.adapter.list()[0]!; await f.adapter.start(row.instanceId, f.adapter.revision);
    const text = await commands.list.execute(f.commandContext({ config: { master: 'someone' }, input: { sender: { id: 'reader' } } }));
    expect(text).toContain('conf'); expect(text).toContain('【运行中的 Demo endpoints】'); expect(text).toContain('【Demo 持久账号配置】'); expect(text).not.toContain('synthetic-secret'); expect(f.use).not.toHaveBeenCalled();
  });
  it('retains the master guard before add/remove can reach persistence', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand);
    const denied = f.commandContext({ config: { master: 'alice' }, input: { sender: { id: 'bob' } }, params: { id: 'bot' }, args: ['token=synthetic'] });
    expect(await commands.add.execute(denied)).toBe(endpointCommandForbidden('Demo')); expect(await commands.remove.execute(denied)).toBe(endpointCommandForbidden('Demo')); expect(f.repository.compareAndSet).not.toHaveBeenCalled();
    const allowed = f.commandContext({ config: { master: 'alice' }, input: { sender: { id: 'alice' } }, params: { id: 'bot' }, args: ['token=synthetic'] });
    expect(await commands.add.execute(allowed)).toContain('尚未启动'); expect(f.adapter.list().map(row => row.endpointId)).toEqual(['bot']);
  });
  it('rejects missing/empty/undeclared/malformed fields without writing and keeps duplicate CAS conflicts separate', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand);
    for (const args of [[], ['token='], ['token'], ['token=synthetic', 'ghost=x']]) {
      const text = await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args })); expect(text).not.toContain('配置已保存');
    }
    expect(await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: [] }))).toContain('缺少必填字段：token');
    expect(await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: ['token=synthetic', 'ghost=x'] }))).toContain('未声明'); expect(f.repository.compareAndSet).not.toHaveBeenCalled();
    await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: ['token=synthetic'] }));
    const duplicate = await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: ['token=another-secret'] }));
    expect(duplicate).toContain('配置已变化'); expect(duplicate).not.toContain('another-secret'); expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1);
  });
  it('uses operation locale and verified mounted command hints without claiming an unbound command entry', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand), paths: string[] = [];
    const text = await commands.add.execute(f.commandContext({ locale: 'en', formatCommand: (path: string) => { paths.push(path); return '!!mounted ' + path; } }));
    expect(text).toContain('Usage: !!mounted demo endpoint add'); expect(text).toContain('Bot token'); expect(paths).toEqual(['demo endpoint add']);
    expect(await commands.add.execute(f.commandContext())).toContain('当前没有可确认的聊天命令入口');
    expect(await commands.list.execute(f.commandContext({ locale: 'en' }))).toContain('[Running Demo endpoints]');
    const denied = f.commandContext({ locale: 'en', config: { master: 'alice' }, input: { sender: { id: 'bob' } } });
    expect(await commands.add.execute(denied)).toBe('Only master may manage Demo endpoints'); expect(f.repository.compareAndSet).not.toHaveBeenCalled();
  });
  it('requires first-migration confirmation through Console instead of mutating static accounts from a chat command', async () => {
    const f = await accountRuntimeFixture({ migration: true, config: { endpoints: [{ id: 'static', token: 'synthetic' }] } }), commands = createEndpointCommands(demoSpec, defineCommand);
    expect(await commands.add.execute(f.commandContext({ params: { id: 'new' }, args: ['token=synthetic'] }))).toContain('确认一次迁移');
    expect(f.repository.compareAndSet).not.toHaveBeenCalled(); expect(f.adapter.list().map(row => row.endpointId)).toEqual(['static']);
  });
  it('removes the actual desired account without restart and keeps empty/missing target errors safe', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand);
    expect(await commands.remove.execute(f.commandContext({ params: { id: ' ' }, formatCommand: () => '!demo endpoint remove' }))).toContain('用法：!demo endpoint remove <id>');
    expect(await commands.remove.execute(f.commandContext())).toContain('当前没有可确认的聊天命令入口');
    await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: ['token=synthetic'] }));
    const removed = await commands.remove.execute(f.commandContext({ params: { id: 'bot' } })); expect(removed).toContain('删除配置已保存'); expect(removed).not.toContain('重启'); expect(f.adapter.list()).toEqual([]);
    expect(await commands.remove.execute(f.commandContext({ params: { id: 'missing' } }))).not.toContain('删除配置已保存'); expect(f.repository.compareAndSet).toHaveBeenCalledTimes(2); expect(f.use).not.toHaveBeenCalled();
  });
  it('does not retry an unknown CAS outcome or disguise it as an input failure', async () => {
    const f = await accountRuntimeFixture(), commands = createEndpointCommands(demoSpec, defineCommand);
    f.repository.compareAndSet.mockRejectedValue(new AdapterManagementError('commit_unknown', 'synthetic unknown outcome'));
    const text = await commands.add.execute(f.commandContext({ params: { id: 'bot' }, args: ['token=synthetic'] }));
    expect(text).toContain('提交结果未知'); expect(text).toContain('勿重复提交'); expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1);
  });
  it('fails closed without runtime context instead of invoking a legacy file/env writer or bind flow', async () => {
    const writer = { list: vi.fn(), add: vi.fn(), remove: vi.fn() }, bindFlow = vi.fn();
    const commands: ReturnType<typeof createEndpointCommands<ReturnType<typeof defineCommand>>> = Reflect.apply(createEndpointCommands, undefined, [{ ...demoSpec, bindFlow }, defineCommand]);
    const context = { use: () => writer, params: { id: 'bot' }, args: ['token=synthetic'], config: undefined } as never;
    for (const command of [commands.list, commands.add, commands.remove]) await expect(command.execute(context)).rejects.toMatchObject({ code: 'unsupported' });
    expect(writer.list).not.toHaveBeenCalled(); expect(writer.add).not.toHaveBeenCalled(); expect(writer.remove).not.toHaveBeenCalled(); expect(bindFlow).not.toHaveBeenCalled();
  });
});
