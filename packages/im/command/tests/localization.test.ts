import {
  childPluginId, createCapabilitySlot, rootPluginId, htmlRendererToken,
  type CapabilitySlot, type Locale, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, type CommandDefinition } from '../src/index.js';
import { renderCommandMenu } from '../src/command-menu.js';

const root = rootPluginId();
const reminders = childPluginId(root, 'reminders');
const other = childPluginId(root, 'other');

function command(localName: string, definition: CommandDefinition, owner = reminders) {
  return createCapabilitySlot({ owner, feature: commandFeatureId, localName,
    source: `/plugins/${owner}/commands/${localName}/index.ts`, definition });
}

function snapshot(slots: readonly CapabilitySlot<CommandDefinition>[], locale: Locale = 'zh-CN'): RuntimeSnapshot {
  return {
    generation: 1, root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'test-root', packageRoot: '/project', children: [reminders, other] }],
      [reminders, { id: reminders, instanceKey: 'reminders', packageName: 'test-reminders', packageRoot: '/project/reminders', parent: root, children: [] }],
      [other, { id: other, instanceKey: 'other', packageName: 'test-other', packageRoot: '/project/other', parent: root, children: [] }],
    ]),
    config: new Map([[root, { locale }], [reminders, { commandNamespace: 'daily' }], [other, { commandNamespace: 'work' }]]),
    resources: new Map([[root, new Map()], [reminders, new Map()], [other, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
}

function message(locale?: Locale) {
  return { ...(locale ? { locale } : {}), conversation: {
    endpoint: { adapter: 'root/chat', id: 'bot-one' }, kind: 'group' as const, id: 'group-one',
  }, sender: { id: 'sender-one' } };
}

describe('operation-scoped command localization', () => {
  it('uses each sender language on one index and keeps the default menu keyword language-specific', async () => {
    const slots = [command('list', defineCommand({ description: '查看提醒', descriptionI18n: { en: 'List reminders' }, execute: () => 'ok' }))];
    const state = snapshot(slots);
    const index = new CommandIndex(slots, state, {});
    const [chinese, english] = await Promise.all([
      index.dispatch('菜单 reminders', message('zh-CN'), undefined, '/'),
      index.dispatch('menu reminders', message('en'), undefined, '!'),
    ]);
    expect(chinese.menu).toMatchObject({ locale: 'zh-CN', keyword: '菜单', commands: [{ name: '/daily list', description: '查看提醒' }] });
    expect(english.menu).toMatchObject({ locale: 'en', keyword: 'menu', commands: [{ name: '!daily list', description: 'List reminders' }] });
    expect(english.value).toContain('command menu');
    expect((await index.dispatch('菜单', message('en'))).matched).toBe(false);
    expect((await index.dispatch('menu', message('zh-CN'))).matched).toBe(false);
    expect((await index.dispatch('菜单')).menu?.locale).toBe('zh-CN');
    const englishProject = new CommandIndex(slots, snapshot(slots, 'en'), {});
    expect((await englishProject.dispatch('menu')).menu?.locale).toBe('en');
  });

  it('preserves explicit menu keywords and pins a navigation operation to its original locale', async () => {
    const slots = Array.from({ length: 31 }, (_, index) => command(`item${index}`, defineCommand({ execute() {} }), root));
    const state = snapshot(slots);
    const index = new CommandIndex(slots, state, {});
    const first = await index.dispatch('menu', message('en'), undefined, '#');
    expect(first.menu).toMatchObject({ locale: 'en', page: 1, pages: 2 });
    const second = await index.dispatch('menu --page 2', message('zh-CN'), undefined, '#', state, first.menu!.locale);
    expect(second.menu).toMatchObject({ locale: 'en', page: 2 });
    expect(second.value).toContain('Previous page: #menu --page 1');
    const custom = new CommandIndex(slots, state, { keyword: 'commands' });
    expect(index.formatMenu('!', 'en')).toBe('!menu');
    expect(index.formatMenu('', 'zh-CN')).toBe('菜单');
    expect(index.formatMenu(undefined, 'en')).toBeUndefined();
    expect(custom.formatMenu('/', 'en')).toBe('/commands');
    expect(new CommandIndex(slots, state).formatMenu('/', 'en')).toBeUndefined();
    expect((await custom.dispatch('commands', message('zh-CN'))).menu?.keyword).toBe('commands');
    expect((await custom.dispatch('commands', message('en'))).menu?.keyword).toBe('commands');
    expect((await custom.dispatch('menu', message('en'))).matched).toBe(false);
  });

  it('localizes validation and help while retaining reason, parameters and author text', async () => {
    const execute = vi.fn();
    const slot = command('remind', defineCommand({
      description: '创建提醒', descriptionI18n: { en: 'Create a reminder' },
      params: { minutes: { type: 'integer', min: 1, description: '分钟数', descriptionI18n: { en: 'Minutes' } } },
      options: { count: { type: 'integer', default: 1, description: '次数', descriptionI18n: { en: 'Count' } } }, execute,
    }));
    const index = new CommandIndex([slot], snapshot([slot]));
    const zh = await index.dispatch('daily remind 0', message('zh-CN'), undefined, '/');
    const en = await index.dispatch('daily remind 0', message('en'), undefined, '!');
    expect(zh.issues?.[0]).toMatchObject({ code: 'minimum', field: 'minutes', parameters: { field: 'minutes', minimum: 1 }, message: 'minutes：最小值为 1' });
    expect(en.issues?.[0]).toMatchObject({ code: 'minimum', parameters: zh.issues?.[0]?.parameters, message: 'minutes: minimum 1' });
    const help = await index.dispatch('daily remind --help', message('en'), undefined, '!');
    expect(help.value).toContain('!daily remind <minutes>');
    expect(help.value).toContain('Create a reminder');
    expect(help.value).toContain('Minutes');
    expect(help.value).toContain('default: 1');
    expect(index.list('en')[0]).toMatchObject({ description: 'Create a reminder', parameters: [{ description: 'Minutes' }], options: { count: { description: 'Count' } } });
    expect(execute).not.toHaveBeenCalled();

    const custom = command('validate', defineCommand({ params: { name: { type: 'string', validate: () => 'Author-owned detail' } }, execute }));
    const customIndex = new CommandIndex([custom], snapshot([custom]));
    expect((await customIndex.dispatch('daily validate x', message('zh-CN'))).issues?.[0]).toMatchObject({ code: 'custom', message: 'Author-owned detail' });
  });

  it.each(['', '/', '!', '!!'])('formats an indexed invocation with actual prefix %j and dispatches it to the referenced command', async prefix => {
    const target = vi.fn(() => 'listed');
    const slots = [
      command('remind/list', defineCommand({ execute: target })),
      command('remind/reference', defineCommand({ execute: context => ({ locale: context.locale, value: context.formatCommand('remind list'), other: context.formatCommand('remind list', other), missing: context.formatCommand('unknown') }) })),
      command('remind/list', defineCommand({ execute: () => 'other account namespace' }), other),
    ];
    const index = new CommandIndex(slots, snapshot(slots));
    const result = await index.dispatch('daily remind reference', message('en'), undefined, prefix);
    expect(result.value).toEqual({ locale: 'en', value: `${prefix}daily remind list`, other: `${prefix}work remind list`, missing: undefined });
    expect(target).not.toHaveBeenCalled();
    const rendered = (result.value as { value: string }).value;
    // CommandIndex receives text after the IM dispatcher removes this exact prefix.
    expect((await index.dispatch(rendered.slice(prefix.length), message('en'), undefined, prefix)).value).toBe('listed');
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('does not invent chat invocations without an actual environment, or for disabled commands', async () => {
    const slots = [
      command('reference', defineCommand({ execute: context => ({ locale: context.locale, value: context.formatCommand('list') }) })),
      command('list', defineCommand({ execute() {} })),
    ];
    const state = snapshot(slots, 'en');
    const index = new CommandIndex(slots, state);
    expect(await index.execute('daily reference')).toEqual({ locale: 'en', value: undefined });
    expect((await index.dispatch('daily reference', message('en'))).value).toEqual({ locale: 'en', value: undefined });
    const disabled = { ...state, config: new Map(state.config).set(reminders, { commandNamespace: 'daily', disabledCommands: ['list'] }) };
    expect((await new CommandIndex(slots, disabled).dispatch('daily reference', message('en'), undefined, '/')).value)
      .toEqual({ locale: 'en', value: undefined });
  });

  it('uses the same language for HTML and text without translating explicit artwork text', async () => {
    const slots = [command('list', defineCommand({ description: '查看提醒', descriptionI18n: { en: 'List reminders' }, execute() {} }))];
    const state = snapshot(slots);
    const htmlState = { ...state, resources: new Map(state.resources).set(root, new Map([[htmlRendererToken.id, {}]])) };
    const response = await new CommandIndex(slots, htmlState, {}).dispatch('menu reminders', message('en'), undefined, '!');
    const html = response.value as { data: { html: string; text: string } };
    expect(html.data.html).toContain('<html lang="en">');
    expect(html.data.html).toContain('List reminders');
    expect(html.data.html).not.toContain('指令指南');
    expect(html.data.text).toBe(response.menu?.text);
    expect(renderCommandMenu('root', [], [], undefined, '', { locale: 'en', appearance: { title: '自定义标题' } }).data.html).toContain('自定义标题');
  });
});


it('selects explicit localized aliases in help, menu and references without changing routes', async () => {
  const target = vi.fn(({ params }) => params.id);
  const slots = [
    command('提醒/详情/$id', { ...defineCommand({
      alias: ['reminder detail'], preferredAliasI18n: { en: 'reminder detail' },
      params: { id: { type: 'integer' } }, execute: target,
    }), $parameter: { name: 'id', type: 'integer' } }),
    command('reference', defineCommand({ execute: context => context.formatCommand('提醒 详情') })),
  ];
  const index = new CommandIndex(slots, snapshot(slots), {});
  expect((await index.dispatch('daily reference', message('en'), undefined, '!!')).value).toBe('!!daily reminder detail');
  expect((await index.dispatch('daily reference', message('zh-CN'), undefined, '!!')).value).toBe('!!daily 提醒 详情');
  expect((await index.dispatch('daily reminder detail --help', message('en'), undefined, '!!')).value).toContain('!!daily reminder detail <id>');
  expect((await index.dispatch('menu reminders', message('en'), undefined, '!!')).menu?.commands).toContainEqual(expect.objectContaining({ name: '!!daily reminder detail <id>' }));
  expect(index.list('en').find(item => item.alias)?.name).toBe('daily reminder detail <id>');
  expect((await index.dispatch('daily reminder detail 42', message('zh-CN'), undefined, '!!')).value).toBe(42);
  expect((await index.dispatch('daily 提醒 详情 43', message('en'), undefined, '!!')).value).toBe(43);
  expect(target).toHaveBeenCalledTimes(2);
});

it('rejects display aliases that do not exist and preserves route collision checks', () => {
  expect(() => defineCommand({ preferredAliasI18n: { en: 'missing' }, execute() {} })).toThrow('must reference a declared alias');
  expect(() => defineCommand({ alias: ['real'], preferredAliasI18n: { en: 'other' }, execute() {} })).toThrow('must reference a declared alias');
  const first = command('原名', defineCommand({ alias: ['existing'], preferredAliasI18n: { en: ' existing ' }, execute() {} }));
  const second = command('existing', defineCommand({ execute() {} }));
  expect(() => new CommandIndex([first, second], snapshot([first, second]))).toThrow('Duplicate Command route');
});
