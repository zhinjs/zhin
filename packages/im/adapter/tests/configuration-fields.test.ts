import { readConfigurationPath, writeConfigurationPath } from '../src/configuration-fields.js';

describe('declared account configuration paths', () => {
  it('updates a nested field without replacing sibling connection settings', () => {
    const config = { smtp: { port: 465, auth: { user: 'bot', pass: 'old' } }, enabled: false };
    writeConfigurationPath(config, 'smtp.auth.pass', 'new');
    expect(config).toEqual({ smtp: { port: 465, auth: { user: 'bot', pass: 'new' } }, enabled: false });
    expect(readConfigurationPath(config, 'smtp.auth.pass')).toBe('new');
    expect(readConfigurationPath(config, 'smtp.missing')).toBeUndefined();
  });
  it('does not read prototype properties or write unsafe paths', () => {
    expect(readConfigurationPath({}, 'toString')).toBeUndefined();
    const config = {};
    for (const path of ['__proto__.polluted', 'smtp.constructor.prototype', 'smtp..port']) {
      expect(() => writeConfigurationPath(config, path, true)).toThrow();
    }
    expect(config).toEqual({}); expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });
});
