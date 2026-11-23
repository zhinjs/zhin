/**
 * Pure helpers of `scripts/measure-instance-memory.mjs` (ADR 0068 P0, #1250): argument parsing,
 * `/proc` parsing, loaded-module classification, heap-snapshot parsing and aggregation, and the
 * RSS attribution table. Nothing here starts a process or touches the file system, except
 * `readProcessTree()` / `readSmapsByMapping()`, which take the `/proc` reader as a parameter.
 */

/** Options that take a value; everything else in {@link OPTION_SPEC} is a boolean flag. */
export const OPTION_SPEC = Object.freeze({
  '--project': 'string',
  '--config': 'string',
  '--with-pages': 'boolean',
  '--settle': 'number',
  '--source': 'boolean',
  '--keep': 'boolean',
  '--json': 'boolean',
  '--verbose': 'boolean',
  '--breakdown': 'boolean',
  '--heap-snapshot': 'string',
  '--top': 'number',
  '--after-turn': 'boolean',
  '--turns': 'number',
  '--idle': 'number',
  '--host-tmpdir': 'boolean',
  '--in-place': 'boolean',
});

/**
 * Parses the script's command line. Throws on an unknown flag, a missing value or a non-numeric
 * number so a typo never silently measures the wrong thing.
 * @param {readonly string[]} argv
 */
export function parseMeasureArgs(argv) {
  const options = {
    project: 'examples/minimal-bot',
    config: undefined,
    withPages: false,
    settleSeconds: 8,
    source: false,
    keep: false,
    json: false,
    verbose: false,
    breakdown: false,
    heapSnapshot: undefined,
    top: 15,
    afterTurn: false,
    turns: 3,
    idleSeconds: 10,
    hostTmpdir: false,
    inPlace: false,
  };
  const keys = {
    '--project': 'project', '--config': 'config', '--with-pages': 'withPages', '--settle': 'settleSeconds',
    '--source': 'source', '--keep': 'keep', '--json': 'json', '--verbose': 'verbose', '--breakdown': 'breakdown',
    '--heap-snapshot': 'heapSnapshot', '--top': 'top', '--after-turn': 'afterTurn', '--turns': 'turns', '--idle': 'idleSeconds', '--host-tmpdir': 'hostTmpdir',
    '--in-place': 'inPlace',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const kind = OPTION_SPEC[name];
    if (!kind) throw new Error(`unknown option ${arg}`);
    if (kind === 'boolean') {
      if (inline !== undefined) throw new Error(`${name} takes no value`);
      options[keys[name]] = true;
      continue;
    }
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new Error(`${name} needs a value`);
    if (kind === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error(`${name} needs a non-negative number, got ${value}`);
      options[keys[name]] = number;
    } else {
      options[keys[name]] = value;
    }
  }
  if (options.withPages && (options.afterTurn || options.config)) throw new Error('--with-pages cannot be combined with --after-turn or --config');
  if (options.inPlace && (options.withPages || options.afterTurn || options.config)) {
    throw new Error('--in-place cannot be combined with --with-pages, --after-turn or --config (they need a copy of the project)');
  }
  if (options.turns < 1) options.turns = 1;
  options.top = Math.max(1, Math.floor(options.top));
  return options;
}

/** Parses `key: value kB` lines of `/proc/<pid>/status` or `smaps_rollup` into bytes (other values kept as numbers). */
export function parseProcKeyValues(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_][\w()]*):\s+(\d+)(?:\s+kB)?\s*$/u.exec(line);
    if (!match) continue;
    result[match[1]] = line.trimEnd().endsWith('kB') ? Number(match[2]) * 1024 : Number(match[2]);
  }
  return result;
}

/**
 * Groups `/proc/<pid>/smaps` by mapping kind and sums each group's Rss / Private_Dirty, so the
 * file-backed part (node binary, shared libraries) can be told apart from anonymous memory.
 * @param {string} text contents of `/proc/<pid>/smaps`
 * @param {string} [execPath] the node binary path
 */
export function summarizeSmaps(text, execPath) {
  const groups = new Map();
  let current;
  const header = /^[0-9a-f]+-[0-9a-f]+\s+\S+\s+\S+\s+\S+\s+\d+\s*(.*)$/u;
  for (const line of text.split('\n')) {
    const head = header.exec(line);
    if (head) {
      current = classifyMapping(head[1].trim(), execPath);
      if (!groups.has(current)) groups.set(current, { mapping: current, rss: 0, privateDirty: 0, count: 0 });
      groups.get(current).count += 1;
      continue;
    }
    if (!current) continue;
    const field = /^(Rss|Private_Dirty):\s+(\d+) kB/u.exec(line);
    if (field) groups.get(current)[field[1] === 'Rss' ? 'rss' : 'privateDirty'] += Number(field[2]) * 1024;
  }
  return [...groups.values()].sort((a, b) => b.rss - a.rss);
}

function classifyMapping(raw, execPath) {
  // A file replaced on disk after it was mapped (an upgraded node binary or .so) keeps its mapping as `path (deleted)`.
  const name = raw.replace(/\s+\(deleted\)$/u, '');
  if (!name) return '[anon]';
  if (execPath && name === execPath) return 'node binary';
  if (name.startsWith('[')) return name.startsWith('[stack') ? '[stack]' : name.replace(/:.*$/u, ']').replace(/\]\]$/u, ']');
  if (/\.so(?:\.\d+)*$/u.test(name) || name.endsWith('.node')) return name.endsWith('.node') ? 'native addons (.node)' : 'shared libraries (.so)';
  if (name.startsWith('/memfd:')) return 'memfd';
  return 'other files';
}

/**
 * Finds the descendants of `rootPid` and their RSS from `/proc`.
 * @param {number} rootPid
 * @param {{ list(): string[]; read(path: string): string | undefined }} proc
 */
export function readProcessTree(rootPid, proc) {
  const children = new Map();
  const info = new Map();
  for (const entry of proc.list()) {
    if (!/^\d+$/u.test(entry)) continue;
    const stat = proc.read(`/proc/${entry}/stat`);
    if (!stat) continue;
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    const pid = Number(entry);
    const ppid = Number(fields[1]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
    info.set(pid, stat.slice(stat.indexOf('(') + 1, close));
  }
  const result = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length) {
    const pid = queue.shift();
    queue.push(...(children.get(pid) ?? []));
    const status = parseProcKeyValues(proc.read(`/proc/${pid}/status`) ?? '');
    const cmdline = (proc.read(`/proc/${pid}/cmdline`) ?? '').split('\0').filter(Boolean);
    result.push({ pid, name: info.get(pid), rss: status.VmRSS ?? 0, command: describeCommand(cmdline) });
  }
  return result.sort((a, b) => b.rss - a.rss);
}

function describeCommand(argv) {
  const base = (path) => path.split(/[\\/]/u).pop();
  if (!argv.length) return '';
  const interesting = argv.slice(1).find((arg) => /esbuild|tsx|worker|\.m?js$/u.test(arg));
  return [base(argv[0]), interesting ? base(interesting) : argv[1] ? base(argv[1]) : ''].filter(Boolean).join(' ');
}

/**
 * Classifies one loaded file.
 * @param {string} path absolute file path (already converted from the `file:` URL)
 * @param {{ project: string; packageOf(path: string): { name: string; root: string } | undefined }} context
 * @returns {{ origin: 'official' | 'third-party' | 'project'; package: string; convention?: string }}
 */
export function classifyModule(path, context) {
  const normalized = path.replaceAll('\\', '/');
  const project = context.project.replaceAll('\\', '/').replace(/\/$/u, '');
  const owner = context.packageOf(path);
  const name = owner?.name ?? thirdPartyName(normalized) ?? '(unknown)';
  const inProject = normalized.startsWith(`${project}/`) && !normalized.slice(project.length).includes('/node_modules/');
  const origin = inProject ? 'project' : isOfficial(name) ? 'official' : 'third-party';
  const root = owner?.root?.replaceAll('\\', '/').replace(/\/$/u, '');
  const relative = root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : undefined;
  const convention = relative ? conventionOf(relative) : undefined;
  return { origin, package: inProject ? `${name} (project)` : name, ...(convention ? { convention } : {}) };
}

/** Convention directories whose files the Plugin Runtime discovers (CLAUDE.md, ADR 0068 §1.3). */
export const CONVENTION_DIRECTORIES = Object.freeze([
  'commands', 'tools', 'handlers', 'middlewares', 'components', 'adapters', 'pages', 'skills', 'agents', 'schedules', 'prompt-sections',
]);

function conventionOf(relative) {
  const first = relative.split('/')[0];
  if (CONVENTION_DIRECTORIES.includes(first)) {
    if ((first === 'skills' || first === 'agents') && relative.includes('/tools/')) return `${first}/*/tools`;
    return first;
  }
  if (first === 'lib' || first === 'src' || first === 'dist') {
    const second = relative.split('/')[1];
    // Built convention files of published plugins live under lib/<convention>/ (build-plugin-runtime-entries).
    if (CONVENTION_DIRECTORIES.includes(second) && first === 'lib') return conventionOf(relative.slice(4));
  }
  return undefined;
}

function isOfficial(name) {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

function thirdPartyName(path) {
  const index = path.lastIndexOf('/node_modules/');
  if (index < 0) return undefined;
  const parts = path.slice(index + '/node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** Extensions whose files are module source V8 keeps as a string; `.json`, `.node` and others are not counted. */
export const SOURCE_MODULE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

/** Whether a loaded file counts towards the module source estimate (query strings ignored). */
export function isSourceModule(path) {
  const clean = path.replace(/[?#].*$/u, '');
  return SOURCE_MODULE_EXTENSIONS.some((extension) => clean.endsWith(extension));
}

/**
 * Bytes V8 needs for a source text kept as a string: Latin-1 sources are one-byte strings, any
 * other character (for example Chinese in messages or descriptions) makes the whole string
 * two-byte. `escaped` is the one-byte size the same text would have with every non-Latin-1
 * character written as a `\\uXXXX` escape (what esbuild's default `charset: 'ascii'` emits).
 * @param {string} text
 */
export function sourceStringBytes(text) {
  // eslint-disable-next-line no-control-regex
  const wide = text.match(/[^\u0000-\u00ff]/gu);
  if (!wide) return { bytes: text.length, twoByte: false, escaped: text.length };
  // A code point above U+FFFF is two UTF-16 units and two escapes (12 chars).
  const extra = wide.reduce((sum, char) => sum + (char.length === 2 ? 10 : 5), 0);
  return { bytes: text.length * 2, twoByte: true, escaped: text.length + extra };
}

/**
 * Groups classified modules by origin, by package (top N per origin) and by convention directory.
 * @param {readonly { path: string; size: number; heapBytes?: number; twoByte?: boolean; escapedBytes?: number }[]} files
 * @param {Parameters<typeof classifyModule>[1]} context
 * @param {number} top
 */
export function groupModules(files, context, top = 15) {
  const origins = {};
  const packages = new Map();
  const conventions = {};
  for (const file of files) {
    const kind = classifyModule(file.path, context);
    const origin = (origins[kind.origin] ??= { files: 0, bytes: 0, packages: 0 });
    origin.files += 1;
    origin.bytes += file.size;
    const key = `${kind.origin}\0${kind.package}`;
    if (!packages.has(key)) {
      packages.set(key, { origin: kind.origin, package: kind.package, files: 0, bytes: 0, heapBytes: 0 });
      origin.packages += 1;
    }
    const entry = packages.get(key);
    entry.files += 1;
    entry.bytes += file.size;
    entry.heapBytes += file.heapBytes ?? file.size;
    if (kind.convention) {
      const convention = (conventions[kind.convention] ??= { files: 0, bytes: 0 });
      convention.files += 1;
      convention.bytes += file.size;
    }
  }
  const byOrigin = {};
  for (const name of ['official', 'third-party', 'project']) {
    byOrigin[name] = [...packages.values()].filter((entry) => entry.origin === name)
      .sort((a, b) => b.files - a.files || b.bytes - a.bytes).slice(0, top)
      .map(({ package: pkg, files: count, bytes, heapBytes }) => ({ package: pkg, files: count, bytes, heapBytes }));
  }
  const sum = (pick) => files.reduce((total, file) => total + pick(file), 0);
  return {
    total: files.length,
    bytes: sum((file) => file.size),
    // V8 keeps every Script's source as a string: one byte per char if it is all Latin-1, two otherwise.
    heapBytes: sum((file) => file.heapBytes ?? file.size),
    escapedBytes: sum((file) => file.escapedBytes ?? file.heapBytes ?? file.size),
    twoByteFiles: files.filter((file) => file.twoByte).length,
    origins,
    topPackages: byOrigin,
    conventions,
  };
}

const SNAPSHOT_KEYS = ['nodes', 'edges', 'strings'];

/**
 * Largest snapshot the script reads: it loads the whole file into one Buffer with
 * `fs.readFileSync()`, which refuses files of 2 GiB or more (`ERR_FS_FILE_TOO_LARGE`).
 */
export const HEAP_SNAPSHOT_MAX_BYTES = 2 ** 31 - 1;

/**
 * The second snapshot of an `--after-turn` run: the path with its `.heapsnapshot` suffix (if
 * any) replaced by `.after-turn.heapsnapshot` (`out.heapsnapshot` → `out.after-turn.heapsnapshot`,
 * `out` → `out.after-turn.heapsnapshot`).
 * @param {string} path
 */
export function afterTurnSnapshotPath(path) {
  return path.replace(/(\.heapsnapshot)?$/u, '.after-turn.heapsnapshot');
}

/**
 * Throws a readable error when a snapshot is too large for {@link parseHeapSnapshot} to be fed.
 * @param {number} size file size in bytes
 * @param {string} path
 */
export function assertHeapSnapshotReadable(size, path) {
  if (size <= HEAP_SNAPSHOT_MAX_BYTES) return;
  throw new Error(`heap snapshot ${path} is ${Math.round(size / 1024 / 1024)} MB; this script reads a snapshot into one Buffer `
    + 'and cannot read 2 GiB or more (fs.readFileSync limit). Open it in Chrome DevTools instead, or measure a smaller project.');
}

/**
 * Parses a `.heapsnapshot` that has been read completely into one Buffer. This is not a streaming
 * parser: the caller holds the whole file in memory (at most {@link HEAP_SNAPSHOT_MAX_BYTES}), but
 * the bytes are scanned in place instead of being decoded into one huge JS string (a 600MB
 * instance writes a snapshot past V8's maximum string length). `snapshot.meta`, `nodes`, `edges`
 * and `strings` are materialised (numbers as `Uint32Array`); the trace sections are skipped.
 * @param {Uint8Array} buffer
 */
export function parseHeapSnapshot(buffer) {
  const text = (start, end) => Buffer.from(buffer.buffer, buffer.byteOffset + start, end - start).toString('utf8');
  const find = (needle, from) => Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).indexOf(needle, from, 'utf8');
  const positions = {};
  let cursor = 0;
  for (const key of SNAPSHOT_KEYS) {
    const at = find(`"${key}":[`, cursor);
    if (at < 0) throw new Error(`heap snapshot has no ${key} section`);
    positions[key] = at + key.length + 4;
    cursor = at;
  }
  const headerEnd = text(0, positions.nodes).lastIndexOf(',');
  const header = JSON.parse(`${text(0, headerEnd)}}`);
  const meta = header.snapshot.meta;
  const nodes = parseNumberArray(buffer, positions.nodes, header.snapshot.node_count * meta.node_fields.length);
  const edges = parseNumberArray(buffer, positions.edges, header.snapshot.edge_count * meta.edge_fields.length);
  const strings = parseStringArray(buffer, positions.strings);
  return { meta, nodes, edges, strings, nodeCount: header.snapshot.node_count, edgeCount: header.snapshot.edge_count };
}

function parseNumberArray(buffer, start, expected) {
  const values = new Uint32Array(Math.max(expected, 0));
  let count = 0;
  let current = 0;
  let inNumber = false;
  for (let index = start; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte >= 48 && byte <= 57) {
      current = current * 10 + (byte - 48);
      inNumber = true;
      continue;
    }
    if (inNumber) {
      if (count >= values.length) throw new Error('heap snapshot section is longer than its count says');
      values[count] = current;
      count += 1;
      current = 0;
      inNumber = false;
    }
    if (byte === 93) break; // ]
  }
  if (count !== values.length) throw new Error(`heap snapshot section has ${count} values, expected ${values.length}`);
  return values;
}

function parseStringArray(buffer, start) {
  const strings = [];
  let index = start;
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (index < buffer.length) {
    const byte = buffer[index];
    if (byte === 93) break; // ]
    if (byte !== 34) { index += 1; continue; } // skip , \n until "
    let end = index + 1;
    let escaped = false;
    for (; end < buffer.length; end += 1) {
      const next = buffer[end];
      if (escaped) { escaped = false; continue; }
      if (next === 92) { escaped = true; continue; }
      if (next === 34) break;
    }
    const raw = view.toString('utf8', index, end + 1);
    strings.push(raw.includes('\\') ? JSON.parse(raw) : raw.slice(1, -1));
    index = end + 1;
  }
  return strings;
}

/** DevTools-style class name of one snapshot node. */
export function snapshotClassName(type, name) {
  switch (type) {
    case 'object':
    case 'native':
      return name || '(anonymous)';
    case 'closure':
      return '(closure)';
    case 'string':
    case 'concatenated string':
    case 'sliced string':
      return '(string)';
    case 'code':
      return '(compiled code)';
    case 'array':
      return '(array)';
    case 'regexp':
      return '(regexp)';
    case 'number':
    case 'heap number':
      return '(number)';
    case 'hidden':
    case 'object shape':
      return '(system)';
    case 'symbol':
      return '(symbol)';
    case 'bigint':
      return '(bigint)';
    case 'synthetic':
      return '(synthetic)';
    default:
      return `(${type})`;
  }
}

/** Large strings are mostly module sources (V8 keeps every Script's source). */
export const LARGE_STRING_BYTES = 16 * 1024;

/**
 * Aggregates a parsed snapshot by class name (self size). Returns the top N classes, and for
 * `(compiled code)` / `(system)` / `(array)` the top names inside them, and the large-string share.
 * @param {ReturnType<typeof parseHeapSnapshot>} snapshot
 * @param {number} [top]
 */
export function aggregateHeapSnapshot(snapshot, top = 30) {
  const { meta, nodes, strings } = snapshot;
  const fields = meta.node_fields;
  const width = fields.length;
  const typeAt = fields.indexOf('type');
  const nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size');
  const types = meta.node_types[typeAt];
  const classes = new Map();
  const details = new Map([['(compiled code)', new Map()], ['(system)', new Map()], ['(array)', new Map()]]);
  let total = 0;
  let largeStrings = 0;
  let largeStringBytes = 0;
  for (let offset = 0; offset < nodes.length; offset += width) {
    const type = types[nodes[offset + typeAt]];
    const name = strings[nodes[offset + nameAt]] ?? '';
    const size = nodes[offset + sizeAt];
    const className = snapshotClassName(type, name);
    if (className === '(synthetic)') continue;
    total += size;
    const entry = classes.get(className) ?? { name: className, count: 0, selfSize: 0 };
    entry.count += 1;
    entry.selfSize += size;
    classes.set(className, entry);
    if (className === '(string)' && size >= LARGE_STRING_BYTES) {
      largeStrings += 1;
      largeStringBytes += size;
    }
    const detail = details.get(className);
    if (detail) {
      const key = detailName(className, name);
      const item = detail.get(key) ?? { name: key, count: 0, selfSize: 0 };
      item.count += 1;
      item.selfSize += size;
      detail.set(key, item);
    }
  }
  const sorted = (map, limit) => [...map.values()].sort((a, b) => b.selfSize - a.selfSize).slice(0, limit)
    .map((item) => ({ ...item, share: total ? item.selfSize / total : 0 }));
  return {
    nodes: nodes.length / width,
    totalSelfSize: total,
    top: sorted(classes, top),
    details: Object.fromEntries([...details].map(([name, map]) => [name, sorted(map, 10)])),
    largeStrings: { threshold: LARGE_STRING_BYTES, count: largeStrings, bytes: largeStringBytes },
    ...(snapshot.edges ? { retainedBy: Object.fromEntries([...retainersOf(snapshot, RETAINER_CLASSES)].map(([name, map]) => [name, sorted(map, 10)])) } : {}),
  };
}

/** Classes whose self size is split by the first retainer ("who holds the strings?"). */
export const RETAINER_CLASSES = Object.freeze(['(string)', '(array)', 'system / JSArrayBufferData']);

/**
 * For every node of the given classes, takes the first strong edge that points at it (in node
 * order) and groups the node's self size by `<retainer class>.<edge name>`, e.g.
 * `(compiled code).source` (a Script's source) or `Object.fileName`. One retainer is a cheap
 * approximation of DevTools' retainer view, not a dominator tree.
 */
function retainersOf(snapshot, wanted) {
  const { meta, nodes, edges, strings } = snapshot;
  const width = meta.node_fields.length;
  const edgeWidth = meta.edge_fields.length;
  const typeAt = meta.node_fields.indexOf('type');
  const nameAt = meta.node_fields.indexOf('name');
  const sizeAt = meta.node_fields.indexOf('self_size');
  const countAt = meta.node_fields.indexOf('edge_count');
  const edgeTypeAt = meta.edge_fields.indexOf('type');
  const edgeNameAt = meta.edge_fields.indexOf('name_or_index');
  const edgeToAt = meta.edge_fields.indexOf('to_node');
  const nodeTypes = meta.node_types[typeAt];
  const edgeTypes = meta.edge_types[edgeTypeAt];
  const classOf = (offset) => snapshotClassName(nodeTypes[nodes[offset + typeAt]], strings[nodes[offset + nameAt]] ?? '');
  const assigned = new Uint8Array(nodes.length / width);
  const groups = new Map(wanted.map((name) => [name, new Map()]));
  let edge = 0;
  for (let offset = 0; offset < nodes.length; offset += width) {
    const end = edge + nodes[offset + countAt] * edgeWidth;
    let owner;
    for (; edge < end; edge += edgeWidth) {
      const kind = edgeTypes[edges[edge + edgeTypeAt]];
      if (kind === 'weak' || kind === 'shortcut') continue;
      const target = edges[edge + edgeToAt];
      const index = target / width;
      if (assigned[index]) continue;
      const group = groups.get(classOf(target));
      if (!group) continue;
      assigned[index] = 1;
      owner ??= classOf(offset);
      const label = kind === 'element' || kind === 'hidden' ? `[${kind}]` : strings[edges[edge + edgeNameAt]];
      const key = `${owner}.${label}`;
      const item = group.get(key) ?? { name: key, count: 0, selfSize: 0 };
      item.count += 1;
      item.selfSize += nodes[target + sizeAt];
      group.set(key, item);
    }
  }
  return groups;
}

function detailName(className, name) {
  if (className === '(compiled code)') {
    // Code nodes are named after their function; group them by the V8 kind in parentheses.
    const kind = /^\(([^)]*)\)/u.exec(name);
    return kind ? `(${kind[1]})` : name.startsWith('system / ') ? name : '(functions / scripts)';
  }
  return name.length > 60 ? `${name.slice(0, 57)}...` : name || '(unnamed)';
}

const MB = 1024 * 1024;
/** Bytes to MB with one decimal. */
export const mb = (bytes) => Math.round((bytes / MB) * 10) / 10;

/** Printed under the RSS attribution table: the V8 / external counters are allocations, not resident pages. */
export const RSS_ATTRIBUTION_NOTE = 'counters report allocated, not resident, memory, so the rows can add up to more than 100% '
  + '(the remainder is then 0)';

/**
 * Builds an approximate RSS attribution from one sample. The rows overlap where V8 does not
 * report separately (malloc'd V8 memory and native allocations of Node / libuv / ICU / SQLite
 * both live in RssAnon); `remainder` is what none of the reported counters explain. The counters
 * are allocated sizes, not resident pages (an untouched ArrayBuffer or committed heap page need not
 * be in RSS), so the rows can add up to more than RSS; the remainder is then cut to 0.
 * @param {{ memory: NodeJS.MemoryUsage; heap: Record<string, number>; status?: Record<string, number> }} sample
 */
export function attributeRss(sample) {
  const rss = sample.status?.VmRSS ?? sample.memory.rss;
  const heapPhysical = sample.heap.total_physical_size ?? sample.memory.heapTotal;
  const rows = [
    { item: 'V8 heap (committed, physical)', bytes: heapPhysical },
    { item: 'V8 malloced (outside the JS heap)', bytes: sample.heap.malloced_memory ?? 0 },
    { item: 'ArrayBuffers (Buffers, typed arrays)', bytes: sample.memory.arrayBuffers },
    { item: 'other external (WebAssembly memory, external strings)', bytes: Math.max(0, sample.memory.external - sample.memory.arrayBuffers) },
  ];
  if (sample.status?.RssFile !== undefined) rows.push({ item: 'file-backed (node binary, .so, mapped files)', bytes: sample.status.RssFile + (sample.status.RssShmem ?? 0) });
  const explained = rows.reduce((sum, row) => sum + row.bytes, 0);
  rows.push({ item: 'remainder (native: Node/libuv/ICU/SQLite, threads, workers, fragmentation)', bytes: Math.max(0, rss - explained) });
  return { rss, exceedsRss: explained > rss, rows: rows.map((row) => ({ ...row, share: rss ? row.bytes / rss : 0 })) };
}
