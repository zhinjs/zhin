/**
 * zhin.config.yml 中 plugins.qq.endpoints 的读写（Plugin Runtime 版）。
 * 用 yaml Document 操作以保留现有注释；仅支持 .yml/.yaml，其它格式报错提示手动处理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMap, isSeq, parseDocument, type YAMLSeq } from 'yaml';
import { resolveProjectRoot } from './qq-bind-persist.js';

export interface QqEndpointConfigEntry {
  name: string;
  appid: string;
  secret: string;
  [key: string]: unknown;
}

const CONFIG_BASENAME = 'zhin.config';
const YAML_EXTENSIONS = ['.yml', '.yaml'] as const;

/** 定位项目配置文件：ZHIN_CONFIG 指定优先，否则发现 zhin.config.yml/.yaml，都没有则默认新建 zhin.config.yml */
export function findQqConfigFile(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  const envConfig = process.env.ZHIN_CONFIG?.trim();
  if (envConfig) return path.resolve(root, envConfig);
  for (const ext of YAML_EXTENSIONS) {
    const candidate = path.join(root, `${CONFIG_BASENAME}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of ['.json', '.toml', '.ts'] as const) {
    const candidate = path.join(root, `${CONFIG_BASENAME}${ext}`);
    if (fs.existsSync(candidate)) {
      throw new Error(`暂不支持写入 ${ext} 配置文件，请手动在 ${CONFIG_BASENAME}${ext} 的 plugins.qq.endpoints 中维护`);
    }
  }
  return path.join(root, `${CONFIG_BASENAME}.yml`);
}

interface QqConfigDocument {
  filePath: string;
  doc: ReturnType<typeof parseDocument>;
}

function readConfigDocument(projectRoot?: string): QqConfigDocument {
  const filePath = findQqConfigFile(projectRoot);
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const doc = parseDocument(content || '{}');
  return { filePath, doc };
}

function writeConfigDocument({ filePath, doc }: QqConfigDocument): void {
  fs.writeFileSync(filePath, doc.toString());
}

/** 读取 plugins.qq.endpoints（plain JS）；plugins/qq 缺失或形态不符时返回 [] */
export function listQqEndpointEntries(projectRoot?: string): QqEndpointConfigEntry[] {
  const { doc } = readConfigDocument(projectRoot);
  const plugins = doc.toJS()?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return [];
  const endpoints = (plugins as { qq?: { endpoints?: unknown } }).qq?.endpoints;
  if (!Array.isArray(endpoints)) return [];
  return endpoints.filter(
    (entry): entry is QqEndpointConfigEntry =>
      !!entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string',
  );
}

function entryName(item: unknown): string | undefined {
  if (!isMap(item)) return undefined;
  const name = item.get('name');
  return typeof name === 'string' && name ? name : undefined;
}

/**
 * 确保 plugins.qq.endpoints 存在并返回其 YAMLSeq（节点级操作，保留既有条目与注释）。
 * `plugins: []`（legacy 空列表，Runtime 忽略）可直接替换为 map；非空数组拒绝写入。
 */
function ensureEndpointsSeq(doc: ReturnType<typeof parseDocument>): YAMLSeq {
  const plugins = doc.get('plugins');
  if (isSeq(plugins) && plugins.items.length > 0) {
    throw new Error('配置的 plugins 是数组形态（legacy 插件名列表），请手动迁移为 map 后再试');
  }
  if (plugins !== undefined && !isMap(plugins) && !isSeq(plugins)) {
    throw new Error('配置的 plugins 字段形态异常，请手动检查 zhin.config.yml');
  }
  if (!isMap(doc.get('plugins'))) {
    // 注意：空对象 {} 不会被 doc.set 自动包装为 YAMLMap，必须显式 createNode
    doc.set('plugins', doc.createNode({}));
  }
  const qq = doc.getIn(['plugins', 'qq']);
  if (qq !== undefined && !isMap(qq)) {
    throw new Error('配置的 plugins.qq 字段形态异常，请手动检查 zhin.config.yml');
  }
  if (!isMap(doc.getIn(['plugins', 'qq']))) {
    doc.setIn(['plugins', 'qq'], doc.createNode({}));
  }
  const endpoints = doc.getIn(['plugins', 'qq', 'endpoints']);
  if (endpoints !== undefined && !isSeq(endpoints)) {
    throw new Error('配置的 plugins.qq.endpoints 字段形态异常，请手动检查 zhin.config.yml');
  }
  if (!isSeq(doc.getIn(['plugins', 'qq', 'endpoints']))) {
    doc.setIn(['plugins', 'qq', 'endpoints'], doc.createNode([]));
  }
  return doc.getIn(['plugins', 'qq', 'endpoints']) as YAMLSeq;
}

/** 追加 endpoint 到 plugins.qq.endpoints；name 已存在时报错 */
export function addQqEndpointToConfig(
  entry: QqEndpointConfigEntry,
  projectRoot?: string,
): string {
  const document = readConfigDocument(projectRoot);
  const seq = ensureEndpointsSeq(document.doc);
  if (seq.items.some((item) => entryName(item) === entry.name)) {
    throw new Error(`配置中已存在 qq endpoint「${entry.name}」，可先 qq endpoint remove ${entry.name} 再重新添加`);
  }
  seq.items.push(document.doc.createNode(entry));
  writeConfigDocument(document);
  return document.filePath;
}

/** 按 name 移除 plugins.qq.endpoints 项；不存在返回 false */
export function removeQqEndpointFromConfig(
  name: string,
  projectRoot?: string,
): { removed: boolean; filePath: string } {
  const document = readConfigDocument(projectRoot);
  const seq = ensureEndpointsSeq(document.doc);
  const next = seq.items.filter((item) => entryName(item) !== name);
  if (next.length === seq.items.length) {
    return { removed: false, filePath: document.filePath };
  }
  seq.items = next;
  writeConfigDocument(document);
  return { removed: true, filePath: document.filePath };
}
