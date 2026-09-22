import { SystemEvent } from '../src/system-event.js';
import { buildSystem } from '../src/side-event/normalize.js';

const context = { endpoint: { adapter: 'root/icqq', id: 'capability-1' }, generation: 7, client: () => ({ live: true }) };

describe('independent SystemEvent', () => {
  it('keeps native login data in metadata without importing chat fields or native identity', () => {
    const raw = { type: 'native', id: 'native-id', conversation: 'native-context', actor: 'sdk-actor', url: 'https://example.test/login' };
    const event = new SystemEvent(buildSystem(raw, {
      id: 'login-1', type: 'system', name: 'system.login.slider', timestamp: 1000,
    }), context);
    expect(event).toMatchObject({ id: 'login-1', type: 'system', name: 'system.login.slider', generation: 7, endpoint: context.endpoint });
    expect(event.metadata).toEqual(raw);
    expect(event).not.toHaveProperty('conversation');
    expect(event).not.toHaveProperty('actor');
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.endpoint)).toBe(true);
  });

  it('rejects a semantic name from another event category', () => {
    expect(() => new SystemEvent(buildSystem({}, {
      id: 'wrong', type: 'system', name: 'notice.login.qrcode', timestamp: 0,
    }), context)).toThrow('Event name must belong to its event type');
  });
});
