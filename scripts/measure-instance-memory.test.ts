import { describe, expect, it } from 'vitest';
import {
  afterTurnSnapshotPath,
  aggregateHeapSnapshot,
  assertHeapSnapshotReadable,
  attributeRss,
  classifyModule,
  HEAP_SNAPSHOT_MAX_BYTES,
  isSourceModule,
  groupModules,
  parseHeapSnapshot,
  parseMeasureArgs,
  parseProcKeyValues,
  readProcessTree,
  snapshotClassName,
  sourceStringBytes,
  summarizeSmaps,
} from './lib/instance-memory.mjs';

describe('parseMeasureArgs', () => {
  it('keeps the defaults of the original script', () => {
    expect(parseMeasureArgs([])).toMatchObject({
      project: 'examples/minimal-bot', settleSeconds: 8, source: false, json: false, breakdown: false,
      heapSnapshot: undefined, afterTurn: false, turns: 3, idleSeconds: 10, top: 15, hostTmpdir: false, inPlace: false,
    });
  });

  it('reads values, inline values and flags', () => {
    expect(parseMeasureArgs([
      '--project', 'examples/test-bot', '--config=examples/test-bot/zhin.config.example.yml', '--settle', '12',
      '--breakdown', '--json', '--heap-snapshot', 'out.heapsnapshot', '--after-turn', '--turns=5', '--idle', '0', '--top', '7.9',
    ])).toMatchObject({
      project: 'examples/test-bot', config: 'examples/test-bot/zhin.config.example.yml', settleSeconds: 12,
      breakdown: true, json: true, heapSnapshot: 'out.heapsnapshot', afterTurn: true, turns: 5, idleSeconds: 0, top: 7,
    });
  });

  it('rejects unknown flags, missing values and bad numbers', () => {
    expect(() => parseMeasureArgs(['--brekdown'])).toThrow(/unknown option --brekdown/u);
    expect(() => parseMeasureArgs(['--heap-snapshot'])).toThrow(/needs a value/u);
    expect(() => parseMeasureArgs(['--heap-snapshot', '--json'])).toThrow(/needs a value/u);
    expect(() => parseMeasureArgs(['--settle', 'soon'])).toThrow(/non-negative number/u);
    expect(() => parseMeasureArgs(['--json=1'])).toThrow(/takes no value/u);
    expect(() => parseMeasureArgs(['--with-pages', '--after-turn'])).toThrow(/cannot be combined/u);
  });

  it('runs on a copy by default; --in-place only without the options that need one', () => {
    expect(parseMeasureArgs(['--in-place'])).toMatchObject({ inPlace: true });
    expect(() => parseMeasureArgs(['--in-place', '--config', 'x.yml'])).toThrow(/--in-place cannot be combined/u);
    expect(() => parseMeasureArgs(['--in-place', '--after-turn'])).toThrow(/--in-place cannot be combined/u);
    expect(() => parseMeasureArgs(['--in-place', '--with-pages'])).toThrow(/--in-place cannot be combined/u);
  });
});

describe('/proc parsing', () => {
  it('converts kB values to bytes and keeps plain counters', () => {
    expect(parseProcKeyValues('VmRSS:\t  2048 kB\nThreads:\t12\nName:\tnode\nRssAnon:\t 1024 kB\n')).toEqual({
      VmRSS: 2048 * 1024, Threads: 12, RssAnon: 1024 * 1024,
    });
  });

  it('groups smaps by mapping kind', () => {
    const smaps = [
      '55d0-55e0 r-xp 00000000 08:01 123 /usr/bin/node',
      'Rss:                1000 kB',
      'Private_Dirty:         4 kB',
      '7f00-7f10 rw-p 00000000 00:00 0 ',
      'Rss:                 300 kB',
      'Private_Dirty:       300 kB',
      '7f10-7f20 rw-p 00000000 00:00 0 ',
      'Rss:                 200 kB',
      'Private_Dirty:       200 kB',
      '7f20-7f30 r-xp 00000000 08:01 9 /usr/lib/libc.so.6',
      'Rss:                  50 kB',
      '7f30-7f40 rw-p 00000000 00:00 0 [heap]',
      'Rss:                  70 kB',
      '7ffc-7ffd rw-p 00000000 00:00 0 [stack]',
      'Rss:                   8 kB',
    ].join('\n');
    expect(summarizeSmaps(smaps, '/usr/bin/node')).toEqual([
      { mapping: 'node binary', rss: 1000 * 1024, privateDirty: 4 * 1024, count: 1 },
      { mapping: '[anon]', rss: 500 * 1024, privateDirty: 500 * 1024, count: 2 },
      { mapping: '[heap]', rss: 70 * 1024, privateDirty: 0, count: 1 },
      { mapping: 'shared libraries (.so)', rss: 50 * 1024, privateDirty: 0, count: 1 },
      { mapping: '[stack]', rss: 8 * 1024, privateDirty: 0, count: 1 },
    ]);
  });

  it('classifies native addons, named anonymous mappings and deleted files', () => {
    const smaps = [
      '7f00-7f10 r-xp 00000000 08:01 1 /srv/bot/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'Rss:                 400 kB',
      '7f10-7f20 rw-p 00000000 00:00 0 [anon:v8]',
      'Rss:                 300 kB',
      'Private_Dirty:       300 kB',
      '7f20-7f30 rw-p 00000000 00:00 0 [anon:libuv]',
      'Rss:                 100 kB',
      '7f30-7f40 r-xp 00000000 08:01 2 /usr/bin/node (deleted)',
      'Rss:                 900 kB',
      '7f40-7f50 r-xp 00000000 08:01 3 /usr/lib/libstdc++.so.6.0.33 (deleted)',
      'Rss:                  60 kB',
      '7f50-7f60 r--p 00000000 08:01 4 /tmp/cache.bin (deleted)',
      'Rss:                  20 kB',
    ].join('\n');
    expect(summarizeSmaps(smaps, '/usr/bin/node').map(({ mapping, rss, count }) => [mapping, rss / 1024, count])).toEqual([
      ['node binary', 900, 1],
      ['native addons (.node)', 400, 1],
      ['[anon]', 400, 2],
      ['shared libraries (.so)', 60, 1],
      ['other files', 20, 1],
    ]);
  });

  it('finds descendants of a process, not its siblings', () => {
    const files: Record<string, string> = {
      '/proc/10/stat': '10 (node) S 1 10',
      '/proc/11/stat': '11 (esbuild) S 10 10',
      '/proc/12/stat': '12 (some (odd) name) S 11 10',
      '/proc/13/stat': '13 (bash) S 1 13',
      '/proc/11/status': 'VmRSS:\t15000 kB\n',
      '/proc/12/status': 'VmRSS:\t100 kB\n',
      '/proc/11/cmdline': '/x/esbuild\0--service=0.28.1\0--ping\0',
      '/proc/12/cmdline': '',
    };
    const tree = readProcessTree(10, { list: () => ['10', '11', '12', '13', 'self'], read: (path) => files[path] });
    expect(tree).toEqual([
      { pid: 11, name: 'esbuild', rss: 15000 * 1024, command: 'esbuild --service=0.28.1' },
      { pid: 12, name: 'some (odd) name', rss: 100 * 1024, command: '' },
    ]);
  });
});

describe('module classification', () => {
  const packages: Record<string, { name: string; root: string }> = {
    '/repo/packages/im/agent': { name: '@zhin.js/agent', root: '/repo/packages/im/agent' },
    '/repo/plugins/games/lottery': { name: '@zhin.js/plugin-lottery', root: '/repo/plugins/games/lottery' },
    '/repo/node_modules/.pnpm/zod@4/node_modules/zod': { name: 'zod', root: '/repo/node_modules/.pnpm/zod@4/node_modules/zod' },
    '/srv/bot': { name: 'my-bot', root: '/srv/bot' },
  };
  const packageOf = (path: string) => Object.entries(packages).find(([root]) => path.startsWith(`${root}/`))?.[1];
  const context = { project: '/srv/bot', packageOf };

  it('tells official, third-party and project files apart and names convention directories', () => {
    expect(classifyModule('/repo/packages/im/agent/lib/index.js', context)).toEqual({ origin: 'official', package: '@zhin.js/agent' });
    expect(classifyModule('/repo/plugins/games/lottery/commands/draw/index.ts', context))
      .toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery', convention: 'commands' });
    expect(classifyModule('/repo/node_modules/.pnpm/zod@4/node_modules/zod/index.js', context)).toEqual({ origin: 'third-party', package: 'zod' });
    expect(classifyModule('/srv/bot/skills/weather/tools/lookup/index.ts', context))
      .toEqual({ origin: 'project', package: 'my-bot (project)', convention: 'skills/*/tools' });
    expect(classifyModule('/srv/bot/node_modules/@scope/pkg/x.js', { project: '/srv/bot', packageOf: () => undefined }))
      .toEqual({ origin: 'third-party', package: '@scope/pkg' });
  });

  it('finds convention directories of built plugins under lib/ and Skill / Agent private tools', () => {
    expect(classifyModule('/repo/plugins/games/lottery/lib/commands/draw/index.js', context))
      .toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery', convention: 'commands' });
    expect(classifyModule('/repo/plugins/games/lottery/lib/skills/luck/tools/roll/index.js', context))
      .toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery', convention: 'skills/*/tools' });
    expect(classifyModule('/repo/plugins/games/lottery/agents/dealer/tools/deal/index.ts', context))
      .toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery', convention: 'agents/*/tools' });
    expect(classifyModule('/repo/plugins/games/lottery/skills/luck/SKILL.md', context))
      .toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery', convention: 'skills' });
    // Only lib/ holds built convention files; src/ and lib/ files outside a convention directory are plain modules.
    expect(classifyModule('/repo/plugins/games/lottery/src/commands/draw.ts', context)).toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery' });
    expect(classifyModule('/repo/plugins/games/lottery/lib/plugin.js', context)).toEqual({ origin: 'official', package: '@zhin.js/plugin-lottery' });
  });

  it('counts only JS / TS files as module source', () => {
    expect(['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.tsx', 'a.ts?zhin-generation=2'].map((name) => isSourceModule(`/x/${name}`))).toEqual([true, true, true, true, true, true]);
    expect(['package.json', 'better_sqlite3.node', 'README.md', 'a.wasm'].map((name) => isSourceModule(`/x/${name}`))).toEqual([false, false, false, false]);
  });

  it('lists only the top N packages per origin, by file count then size', () => {
    const grouped = groupModules([
      { path: '/repo/node_modules/a/1.js', size: 1 },
      { path: '/repo/node_modules/b/1.js', size: 50 },
      { path: '/repo/node_modules/b/2.js', size: 1 },
      { path: '/repo/node_modules/c/1.js', size: 100 },
      { path: '/repo/node_modules/d/1.js', size: 7 },
    ], { project: '/srv/bot', packageOf: () => undefined }, 2);
    expect(grouped.origins['third-party']).toEqual({ files: 5, bytes: 159, packages: 4 });
    expect(grouped.topPackages['third-party'].map((item) => item.package)).toEqual(['b', 'c']);
    expect(grouped.topPackages.official).toEqual([]);
  });

  it('groups files by origin, package and convention', () => {
    const grouped = groupModules([
      { path: '/repo/packages/im/agent/lib/a.js', size: 100 },
      { path: '/repo/packages/im/agent/lib/b.js', size: 50 },
      { path: '/repo/plugins/games/lottery/commands/draw/index.ts', size: 10 },
      { path: '/repo/node_modules/.pnpm/zod@4/node_modules/zod/index.js', size: 20 },
      { path: '/srv/bot/commands/hi/index.ts', size: 5 },
    ], context, 1);
    expect(grouped.total).toBe(5);
    expect(grouped.bytes).toBe(185);
    expect(grouped.origins).toEqual({
      official: { files: 3, bytes: 160, packages: 2 },
      'third-party': { files: 1, bytes: 20, packages: 1 },
      project: { files: 1, bytes: 5, packages: 1 },
    });
    expect(grouped.topPackages.official).toEqual([{ package: '@zhin.js/agent', files: 2, bytes: 150, heapBytes: 150 }]);
    expect(grouped.conventions).toEqual({ commands: { files: 2, bytes: 15 } });
    expect(grouped.heapBytes).toBe(185);
    expect(grouped.escapedBytes).toBe(185);
    expect(grouped.twoByteFiles).toBe(0);
  });

  it('estimates source strings: Latin-1 is one byte per char, anything else two', () => {
    expect(sourceStringBytes('const a = "é";')).toEqual({ bytes: 14, twoByte: false, escaped: 14 });
    expect(sourceStringBytes('const a = "中";')).toEqual({ bytes: 28, twoByte: true, escaped: 19 });
    expect(sourceStringBytes('x("😀")')).toEqual({ bytes: 14, twoByte: true, escaped: 17 });
    const grouped = groupModules([{ path: '/srv/bot/commands/hi/index.ts', size: 16, heapBytes: 28, twoByte: true, escapedBytes: 19 }], context);
    expect(grouped).toMatchObject({ bytes: 16, heapBytes: 28, escapedBytes: 19, twoByteFiles: 1 });
  });
});

/** A tiny snapshot in V8's format: root → script (code) → source string; root → Map → table array. */
function snapshotFixture() {
  const strings = ['', '(GC roots)', 'file:///a.js', 'const a = "\\u4e2d";', 'Map', 'source', 'table', 'Foo', 'fileName', 'k-1'];
  const nodeTypes = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic',
    'concatenated string', 'sliced string', 'symbol', 'bigint', 'object shape'];
  const edgeTypes = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'];
  const fields = ['type', 'name', 'id', 'self_size', 'edge_count', 'detachedness'];
  const W = fields.length;
  // node: [type, name, id, self_size, edge_count, detachedness]
  const nodes = [
    9, 1, 1, 0, 4, 0, // 0 synthetic root
    4, 2, 3, 40, 1, 0, // 1 code (script)
    2, 3, 5, 2000, 0, 0, // 2 string (script source)
    3, 4, 7, 32, 1, 0, // 3 object Map
    1, 0, 9, 500, 0, 0, // 4 array (Map table)
    3, 7, 11, 24, 1, 0, // 5 object Foo
    2, 9, 13, 16, 0, 0, // 6 string (fileName)
  ];
  // edge: [type, name_or_index, to_node]
  const edges = [
    1, 0, 1 * W, 1, 1, 3 * W, 1, 2, 5 * W, 6, 3, 6 * W, // root: elements + a weak edge to the string
    3, 5, 2 * W, // script.source
    3, 6, 4 * W, // Map.table
    2, 8, 6 * W, // Foo.fileName
  ];
  return {
    snapshot: {
      meta: {
        node_fields: fields, node_types: [nodeTypes, 'string', 'number', 'number', 'number', 'number'],
        edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [edgeTypes, 'string_or_number', 'node'],
      },
      node_count: nodes.length / W, edge_count: edges.length / 3, trace_function_count: 0,
    },
    nodes, edges, trace_function_infos: [], trace_tree: [], samples: [], locations: [], strings,
  };
}

describe('heap snapshot', () => {
  it('names classes the way DevTools groups them', () => {
    expect(snapshotClassName('object', 'Map')).toBe('Map');
    expect(snapshotClassName('concatenated string', 'x')).toBe('(string)');
    expect(snapshotClassName('code', 'foo')).toBe('(compiled code)');
    expect(snapshotClassName('hidden', 'system / Context')).toBe('(system)');
    expect(snapshotClassName('closure', 'f')).toBe('(closure)');
    expect(snapshotClassName('array', '')).toBe('(array)');
  });

  it('parses the on-disk format from a Buffer (escaped strings included)', () => {
    const fixture = snapshotFixture();
    // V8 writes one node per line; the parser must not care about whitespace.
    const text = JSON.stringify(fixture).replace('"nodes":[', '"nodes":[\n').replace('"strings":[', '"strings":[\n');
    const parsed = parseHeapSnapshot(Buffer.from(text, 'utf8'));
    expect(parsed.nodeCount).toBe(7);
    expect(parsed.edgeCount).toBe(7);
    expect([...parsed.nodes]).toEqual(fixture.nodes);
    expect([...parsed.edges]).toEqual(fixture.edges);
    expect(parsed.strings).toEqual(fixture.strings);
    expect(parsed.strings[3]).toBe('const a = "\\u4e2d";');
  });

  it('reads strings containing ] and escaped quotes', () => {
    const fixture = snapshotFixture();
    fixture.strings[8] = 'a]b';
    fixture.strings[9] = 'say "hi" ] \\ done';
    const parsed = parseHeapSnapshot(Buffer.from(JSON.stringify(fixture), 'utf8'));
    expect(parsed.strings).toEqual(fixture.strings);
    expect(parsed.strings[9]).toBe('say "hi" ] \\ done');
  });

  it('names the after-turn snapshot and refuses files over the 2 GiB read limit', () => {
    expect(afterTurnSnapshotPath('/tmp/out.heapsnapshot')).toBe('/tmp/out.after-turn.heapsnapshot');
    expect(afterTurnSnapshotPath('/tmp/out')).toBe('/tmp/out.after-turn.heapsnapshot');
    expect(HEAP_SNAPSHOT_MAX_BYTES).toBe(2 ** 31 - 1);
    expect(() => assertHeapSnapshotReadable(HEAP_SNAPSHOT_MAX_BYTES, '/tmp/a.heapsnapshot')).not.toThrow();
    expect(() => assertHeapSnapshotReadable(2 ** 31, '/tmp/a.heapsnapshot')).toThrow(/2048 MB.*2 GiB or more/u);
  });

  it('rejects a truncated snapshot', () => {
    const text = JSON.stringify(snapshotFixture());
    expect(() => parseHeapSnapshot(Buffer.from(text.replace(/"strings":\[.*$/u, ''), 'utf8'))).toThrow(/no strings section/u);
    expect(() => parseHeapSnapshot(Buffer.from(text.replace('"node_count":7', '"node_count":8'), 'utf8'))).toThrow(/expected 48/u);
  });

  it('aggregates self size by class, splits code, and attributes strings to their first retainer', () => {
    const aggregate = aggregateHeapSnapshot(parseHeapSnapshot(Buffer.from(JSON.stringify(snapshotFixture()))), 3);
    expect(aggregate.nodes).toBe(7);
    expect(aggregate.totalSelfSize).toBe(2612);
    expect(aggregate.top.map(({ name, count, selfSize }) => [name, count, selfSize])).toEqual([
      ['(string)', 2, 2016], ['(array)', 1, 500], ['(compiled code)', 1, 40],
    ]);
    expect(aggregate.top[0].share).toBeCloseTo(2016 / 2612);
    expect(aggregate.details['(compiled code)']).toMatchObject([{ name: '(functions / scripts)', count: 1, selfSize: 40 }]);
    expect(aggregate.largeStrings).toEqual({ threshold: 16 * 1024, count: 0, bytes: 0 });
    // The weak root edge is ignored: Foo.fileName owns the small string, the script owns its source.
    expect(aggregate.retainedBy['(string)'].map(({ name, selfSize }) => [name, selfSize]))
      .toEqual([['(compiled code).source', 2000], ['Foo.fileName', 16]]);
    expect(aggregate.retainedBy['(array)'].map(({ name }) => name)).toEqual(['Map.table']);
  });
});

describe('attributeRss', () => {
  it('splits RSS into reported counters and a remainder', () => {
    const MB = 1024 * 1024;
    const result = attributeRss({
      memory: { rss: 300 * MB, heapTotal: 120 * MB, heapUsed: 80 * MB, external: 30 * MB, arrayBuffers: 4 * MB },
      heap: { total_physical_size: 110 * MB, malloced_memory: 2 * MB },
      status: { VmRSS: 300 * MB, RssFile: 60 * MB, RssShmem: 0 },
    });
    expect(result.rss).toBe(300 * MB);
    expect(result.exceedsRss).toBe(false);
    expect(result.rows.map((row) => Math.round(row.bytes / MB))).toEqual([110, 2, 4, 26, 60, 98]);
    expect(result.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
  });

  it('cuts the remainder to 0 when the counters explain more than RSS', () => {
    const MB = 1024 * 1024;
    const result = attributeRss({
      memory: { rss: 100 * MB, heapTotal: 90 * MB, heapUsed: 50 * MB, external: 40 * MB, arrayBuffers: 30 * MB },
      heap: { total_physical_size: 80 * MB, malloced_memory: 1 * MB },
      status: { VmRSS: 100 * MB, RssFile: 20 * MB },
    });
    expect(result.exceedsRss).toBe(true);
    expect(result.rows.map((row) => Math.round(row.bytes / MB))).toEqual([80, 1, 30, 10, 20, 0]);
    expect(result.rows.at(-1)!.share).toBe(0);
    expect(result.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1.41);
  });

  it('works without /proc (macOS, Windows)', () => {
    const result = attributeRss({
      memory: { rss: 100, heapTotal: 60, heapUsed: 40, external: 10, arrayBuffers: 10 },
      heap: {},
    });
    expect(result.rows.map((row) => row.bytes)).toEqual([60, 0, 10, 0, 30]);
  });
});
