import { resolveDiagnosticPlugin } from '../../../src/plugin-runtime/console/plugin-diagnostics.js';
describe('plugin diagnostics exact identity', () => {
  const first = { instanceKey: 'repeater', packageName: '@zhin.js/plugin-repeater' };
  const second = { instanceKey: 'second', packageName: first.packageName };
  it('resolves an instance to its npm package without treating it as a package', () => {
    expect(resolveDiagnosticPlugin('repeater', [first])).toEqual(first);
    expect(resolveDiagnosticPlugin(first.packageName, [first])).toEqual(first);
    expect(() => resolveDiagnosticPlugin('unknown', [first])).toThrow();
  });
  it('selects exact instances and refuses ambiguous package aliases', () => {
    expect(resolveDiagnosticPlugin('second', [first, second])).toEqual(second);
    expect(() => resolveDiagnosticPlugin(first.packageName, [first, second])).toThrow(/多个/);
    const collision = { instanceKey: first.packageName, packageName: '@example/other' };
    expect(resolveDiagnosticPlugin(first.packageName, [first, collision])).toEqual(collision);
  });
});
