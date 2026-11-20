import {
  createEnvironmentLookup,
  environmentReferencesIn,
  expandEnvironmentValue,
  findUnsetEnvironmentReferences,
  isEnvironmentVariableName,
  isWholeEnvironmentReference,
  parseEnvironmentReference,
  parseEnvUri,
} from '../src/index.js';

describe('parseEnvironmentReference', () => {
  it('parses a whole plain reference', () => {
    expect(parseEnvironmentReference('${API_KEY}')).toEqual({ variable: 'API_KEY' });
    expect(parseEnvironmentReference('${_x9}')).toEqual({ variable: '_x9' });
  });

  it('parses :- and := defaults, including an empty one', () => {
    expect(parseEnvironmentReference('${PORT:-8080}')).toEqual({ variable: 'PORT', default: '8080', operator: ':-' });
    expect(parseEnvironmentReference('${PORT:=8080}')).toEqual({ variable: 'PORT', default: '8080', operator: ':=' });
    expect(parseEnvironmentReference('${PORT:-}')).toEqual({ variable: 'PORT', default: '', operator: ':-' });
    expect(parseEnvironmentReference('${URL:-http://a{b}')).toEqual({ variable: 'URL', default: 'http://a{b', operator: ':-' });
  });

  it('rejects embedded, malformed and invalid-name references', () => {
    for (const value of ['x${A}', '${A}x', ' ${A}', '${A}${B}', '${}', '${1A}', '${A-B}', '${A:x}', '${A', '${A:-x', '$A', '{A}', 'env://A', 42, undefined]) {
      expect(parseEnvironmentReference(value)).toBeUndefined();
      expect(isWholeEnvironmentReference(value)).toBe(false);
    }
    // The default ends at the first `}`: anything after it is surrounding text.
    expect(parseEnvironmentReference('${A:-x}y}')).toBeUndefined();
  });

  it('accepts exactly what expansion replaces as a whole', () => {
    const lookup = (key: string) => (key === 'A' ? 'v' : undefined);
    for (const value of ['${A}', '${A:-d}', '${A:=d}', '${B:-}', '${B:-d}']) {
      expect(isWholeEnvironmentReference(value)).toBe(true);
      expect(expandEnvironmentValue(value, lookup, () => 'missing')).not.toContain('${');
    }
  });
});

describe('environmentReferencesIn', () => {
  it('finds whole and embedded references with their defaults', () => {
    expect(environmentReferencesIn('http://${HOST}:${PORT:-80}/${PATH_:=x}')).toEqual([
      { variable: 'HOST', hasDefault: false, start: 7, end: 14 },
      { variable: 'PORT', default: '80', operator: ':-', hasDefault: true, start: 15, end: 26 },
      { variable: 'PATH_', default: 'x', operator: ':=', hasDefault: true, start: 27, end: 38 },
    ]);
  });

  it('marks an empty default as a default', () => {
    expect(environmentReferencesIn('${A:-}')).toEqual([{ variable: 'A', default: '', operator: ':-', hasDefault: true, start: 0, end: 6 }]);
  });

  it('skips invalid names and malformed text, then keeps scanning', () => {
    expect(environmentReferencesIn('${1A} ${} ${A-B} ${A:x} ${OK}').map(reference => reference.variable)).toEqual(['OK']);
    expect(environmentReferencesIn('${${A}}').map(reference => reference.variable)).toEqual(['A']);
    expect(environmentReferencesIn('${A:-unterminated')).toEqual([]);
    expect(environmentReferencesIn('no references')).toEqual([]);
    expect(environmentReferencesIn(7)).toEqual([]);
  });

  it('has no escape: `$${A}` is a dollar followed by a reference (as expansion does)', () => {
    expect(environmentReferencesIn('$${A}').map(reference => reference.start)).toEqual([1]);
    expect(expandEnvironmentValue('$${A}', key => (key === 'A' ? 'v' : undefined))).toBe('$v');
  });

  it('finds exactly the spans expansion replaces', () => {
    const input = 'a${A}b${B:-d}c${1X}d${C';
    const references = environmentReferencesIn(input);
    let rebuilt = '';
    let index = 0;
    for (const reference of references) {
      rebuilt += input.slice(index, reference.start) + '<' + reference.variable + '>';
      index = reference.end;
    }
    rebuilt += input.slice(index);
    expect(rebuilt).toBe(expandEnvironmentValue(input, key => `<${key}>`));
  });
});

describe('parseEnvUri', () => {
  it('reads a valid env:// URI', () => {
    expect(parseEnvUri('env://OPENAI_API_KEY')).toBe('OPENAI_API_KEY');
    expect(parseEnvUri('env://lower_case1')).toBe('lower_case1');
  });

  it('rejects invalid names and other syntax', () => {
    for (const value of ['env://', 'env://1A', 'env://A-B', 'env://A B', 'env://A/B', ' env://A', 'ENV://A', 'env:/A', '${A}', 'A', 1, null]) {
      expect(parseEnvUri(value)).toBeUndefined();
    }
  });
});

describe('isEnvironmentVariableName', () => {
  it('uses the same name rule as references', () => {
    expect(isEnvironmentVariableName('A_1')).toBe(true);
    expect(isEnvironmentVariableName('_')).toBe(true);
    expect(isEnvironmentVariableName('1A')).toBe(false);
    expect(isEnvironmentVariableName('A.B')).toBe(false);
    expect(isEnvironmentVariableName('')).toBe(false);
  });
});

describe('findUnsetEnvironmentReferences', () => {
  const set = new Set(['SET', 'EMPTY']);
  const isSet = (name: string) => set.has(name);

  it('reports unset plain references anywhere, sorted and unique', () => {
    expect(findUnsetEnvironmentReferences({
      a: '${B_MISSING}', b: ['x${A_MISSING}y', { c: '${B_MISSING} ${SET}' }], d: 3, e: null,
    }, isSet)).toEqual(['A_MISSING', 'B_MISSING']);
  });

  it('never reports references with a default, even an empty one', () => {
    expect(findUnsetEnvironmentReferences(['${A:-x}', '${B:=y}', '${C:-}', '${D}'], isSet)).toEqual(['D']);
  });

  it('ignores invalid names and malformed text', () => {
    expect(findUnsetEnvironmentReferences(['${1A}', '${A-B}', '${UNCLOSED', '$PLAIN'], isSet)).toEqual([]);
  });

  it('tolerates cycles', () => {
    const value: Record<string, unknown> = { a: '${X}' };
    value.self = value;
    expect(findUnsetEnvironmentReferences(value, isSet)).toEqual(['X']);
  });
});

describe('createEnvironmentLookup', () => {
  it('returns the first defined value, highest priority first', () => {
    const lookup = createEnvironmentLookup({ A: 'overlay', C: undefined }, undefined, { A: 'base', B: 'base', C: 'base' });
    expect(lookup('A')).toBe('overlay');
    expect(lookup('B')).toBe('base');
    expect(lookup('C')).toBe('base');
    expect(lookup('D')).toBeUndefined();
  });

  it('keeps an empty value from a higher layer', () => {
    expect(createEnvironmentLookup({ A: '' }, { A: 'base' })('A')).toBe('');
  });
});
