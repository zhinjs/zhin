import {
  childPluginId, createCapabilitySlot, rootPluginId,
  type CapabilitySlot, type Locale, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  CommandIndex, commandFeatureId, defineCommand, isUserFacingError, UserFacingError, userFacingErrorText,
  type CommandDefinition,
} from '../src/index.js';

const root = rootPluginId();
const games = childPluginId(root, 'games');

function command(localName: string, definition: CommandDefinition) {
  return createCapabilitySlot({ owner: games, feature: commandFeatureId, localName,
    source: `/plugins/games/commands/${localName}/index.ts`, definition });
}

function snapshot(slots: readonly CapabilitySlot<CommandDefinition>[]): RuntimeSnapshot {
  return {
    generation: 1, root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'test-root', packageRoot: '/project', children: [games] }],
      [games, { id: games, instanceKey: 'games', packageName: 'test-games', packageRoot: '/project/games', parent: root, children: [] }],
    ]),
    config: new Map([[root, {}], [games, {}]]),
    resources: new Map([[root, new Map()], [games, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
}

function message(locale?: Locale) {
  return { ...(locale ? { locale } : {}), conversation: {
    endpoint: { adapter: 'root/chat', id: 'bot-one' }, kind: 'group' as const, id: 'group-one',
  }, sender: { id: 'sender-one' } };
}

class ConflictError extends UserFacingError {
  override format(locale?: Locale): string {
    return locale === 'en' ? 'Finish your current game first.' : '请先结束当前对局。';
  }
}

describe('UserFacingError at command dispatch', () => {
  it('turns a sender-facing refusal into the command reply in the sender locale', async () => {
    const slots = [command('rps', defineCommand({ execute: () => { throw new ConflictError('conflict'); } }))];
    const index = new CommandIndex(slots, snapshot(slots), {});
    const zh = await index.dispatch({ input: 'rps', source: message('zh-CN') });
    expect(zh).toMatchObject({ matched: true, status: 'executed', command: 'rps', owner: games, value: '请先结束当前对局。' });
    // The refusal is marked so observers can tell it from a successful run; status stays `executed`.
    expect(zh.refused).toBe(true);
    const ok = new CommandIndex([command('ok', defineCommand({ execute: () => 'fine' }))], snapshot([command('ok', defineCommand({ execute: () => 'fine' }))]), {});
    expect((await ok.dispatch({ input: 'ok', source: message('zh-CN') })).refused).toBeUndefined();
    const en = await index.dispatch({ input: 'rps', source: message('en') });
    expect(en.value).toBe('Finish your current game first.');
  });

  it('keeps internal failures out of the reply (no message or stack is shown to the sender)', async () => {
    const internal = new Error('db exploded at /secret/path');
    const slots = [command('rps', defineCommand({ execute: () => { throw internal; } }))];
    const index = new CommandIndex(slots, snapshot(slots), {});
    await expect(index.dispatch({ input: 'rps', source: message() })).rejects.toBe(internal);
  });

  it('recognises the brand across package copies and falls back to message when format fails', () => {
    const foreign = Object.assign(new Error('来自另一份副本'), { [Symbol.for('zhin.command.user-facing-error/1')]: true });
    expect(isUserFacingError(foreign)).toBe(true);
    expect(userFacingErrorText(foreign)).toBe('来自另一份副本');
    const broken = new (class extends UserFacingError { override format(): string { throw new Error('x'); } })('兜底');
    expect(userFacingErrorText(broken)).toBe('兜底');
    expect(userFacingErrorText(new Error('internal'))).toBeUndefined();
    expect(userFacingErrorText(new UserFacingError('   '))).toBeUndefined();
  });
});
