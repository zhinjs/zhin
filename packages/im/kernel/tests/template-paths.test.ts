import { describe, expect, it } from 'vitest';
import { renderTemplatePaths } from '../src/index.js';

const context = {
  adapter: 'sandbox',
  kind: 'group',
  timestamp: 1723370000000,
  mentioned: false,
  empty: '',
  zero: 0,
  nothing: null,
  missing: undefined,
  sender: { id: 'user-42', name: 'Alice', roles: ['admin', 'member'] },
  segments: [{ type: 'text', data: { text: 'hi' } }, { type: 'image' }],
  $ref: 'dollar',
  _private: 'underscore',
};

describe('renderTemplatePaths', () => {
  it('substitutes top-level and nested property paths', () => {
    expect(renderTemplatePaths('Hello ${sender.name} on ${adapter}!', context)).toBe('Hello Alice on sandbox!');
    expect(renderTemplatePaths('${segments[0].type}/${segments[1].type}/${segments[0].data.text}', context)).toBe('text/image/hi');
    expect(renderTemplatePaths('${sender.roles[1]}', context)).toBe('member');
    expect(renderTemplatePaths('${$ref} ${_private}', context)).toBe('dollar underscore');
  });

  it('formats numbers and booleans with String() and keeps falsy values', () => {
    expect(renderTemplatePaths('${timestamp}|${mentioned}|${zero}|[${empty}]', context)).toBe('1723370000000|false|0|[]');
  });

  it('serializes plain objects and arrays as indented JSON', () => {
    expect(renderTemplatePaths('${sender.roles}', context)).toBe(JSON.stringify(['admin', 'member'], null, 2));
    expect(renderTemplatePaths('${sender}', context)).toBe(JSON.stringify(context.sender, null, 2));
  });

  it('tolerates whitespace around the path', () => {
    expect(renderTemplatePaths('${ sender.name }', context)).toBe('Alice');
  });

  it.each([
    'price is ${amount} USD',
    '1+1=${1+1}',
    '${timestamp + 1}',
    '${sender.name.toUpperCase()}',
    '${sender.name.length}',
    '${sender.roles.length}',
    '${sender["name"]}',
    "${sender['name']}",
    '${sender.roles[-1]}',
    '${sender.roles[9]}',
    '${sender.roles.0}',
    '${sender..name}',
    '${.sender}',
    '${sender.}',
    '${sender.name.first}',
    '${nothing}',
    '${missing}',
    '${nothing.x}',
    '${}',
    '${ }',
    '${process.env.HOME}',
    '${globalThis}',
    '${require("fs")}',
    'echo ${HOME:-/root}; echo "${arr[@]}"',
    'const s = `${a}${b ? 1 : 2}`;',
    'unterminated ${adapter',
    '$adapter {adapter} $ {adapter}',
  ])('leaves %s exactly as written', (text) => {
    expect(renderTemplatePaths(text, context)).toBe(text);
  });

  it('never walks the prototype chain', () => {
    for (const text of [
      '${constructor}', '${__proto__}', '${toString}', '${hasOwnProperty}',
      '${sender.constructor}', '${sender.__proto__}', '${sender.__proto__.constructor}',
      '${sender.constructor.constructor}', '${sender.roles.constructor.prototype}', '${segments.map}',
    ]) expect(renderTemplatePaths(text, context)).toBe(text);
    const inherited = Object.create({ secret: 'inherited' }) as Record<string, unknown>;
    inherited.own = 'own';
    expect(renderTemplatePaths('${secret} ${own}', inherited)).toBe('${secret} own');
    // An own enumerable key named like a blocked segment is still refused.
    const hostile = JSON.parse('{"__proto__":{"x":"y"},"constructor":"c","prototype":"p"}') as Record<string, unknown>;
    expect(renderTemplatePaths('${__proto__.x} ${constructor} ${prototype}', hostile)).toBe('${__proto__.x} ${constructor} ${prototype}');
  });

  it('skips non-enumerable properties, accessors, functions and non-plain objects', () => {
    let getterCalls = 0;
    const ctx: Record<string, unknown> = {
      fn: () => 'called',
      date: new Date(0),
      map: new Map([['a', 1]]),
      big: 1n,
      sym: Symbol('s'),
      klass: new (class Secret { token = 't' })(),
    };
    Object.defineProperty(ctx, 'hidden', { value: 'hidden', enumerable: false });
    Object.defineProperty(ctx, 'computed', { get() { getterCalls += 1; return 'computed'; }, enumerable: true });
    const text = '${fn} ${fn.name} ${date} ${map} ${big} ${sym} ${klass} ${hidden} ${computed}';
    expect(renderTemplatePaths(text, ctx)).toBe(text);
    expect(getterCalls).toBe(0);
    // Data inside a non-plain container is still reachable by an explicit path.
    expect(renderTemplatePaths('${klass.token}', ctx)).toBe('t');
  });

  it('leaves values that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(renderTemplatePaths('${cyclic}', { cyclic })).toBe('${cyclic}');
  });

  it('does not rescan substituted values or treat $ sequences in them specially', () => {
    const ctx = { content: '${adapter} $& $1 $$ ${1+1}', adapter: 'sandbox' };
    expect(renderTemplatePaths('you said: ${content} via ${adapter}', ctx)).toBe('you said: ${adapter} $& $1 $$ ${1+1} via sandbox');
  });

  it('treats an inner well-formed placeholder independently of surrounding braces', () => {
    expect(renderTemplatePaths('${`nested ${adapter}`}', context)).toBe('${`nested sandbox`}');
  });

  it('returns text without placeholders untouched', () => {
    expect(renderTemplatePaths('', context)).toBe('');
    expect(renderTemplatePaths('Hello World!', context)).toBe('Hello World!');
  });

  it('stays linear on pathological input', () => {
    const text = '${'.repeat(50_000) + 'a.'.repeat(50_000) + '}';
    const started = performance.now();
    expect(renderTemplatePaths(text, context)).toBe(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
