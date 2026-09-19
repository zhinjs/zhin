import fs from 'node:fs';
import path from 'node:path';
import {
  type AddConfiguredEndpointRequest,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
  type EndpointConfigurationMutation,
  type RemoveConfiguredEndpointResult,
} from '@zhin.js/adapter';
import { isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';

interface FileSnapshot {
  readonly exists: boolean;
  readonly content: string;
}

interface EndpointConfigDocument {
  readonly filePath: string;
  readonly before: FileSnapshot;
  readonly document: ReturnType<typeof parseDocument>;
}

/**
 * Node composition-root implementation of endpoint configuration persistence.
 * It is the sole owner of YAML discovery, comment-preserving edits and `.env`
 * writes used by endpoint management commands.
 */
export class YamlEndpointConfigurationStore implements EndpointConfigurationStore {
  readonly #projectRoot: string;
  readonly #configFile?: string;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: {
    readonly projectRoot: string;
    readonly configFile?: string;
    readonly environment?: NodeJS.ProcessEnv;
  }) {
    this.#projectRoot = path.resolve(options.projectRoot);
    this.#configFile = options.configFile
      ? path.resolve(options.configFile)
      : undefined;
    this.#environment = options.environment ?? process.env;
  }

  list(adapterKey: string): readonly ConfiguredEndpointEntry[] {
    const { document } = this.#readDocument(adapterKey);
    const plugins = document.get('plugins', true);
    if (plugins === undefined) return Object.freeze([]);
    this.#assertMap(plugins, 'plugins');

    const adapter = plugins.get(adapterKey, true);
    if (adapter === undefined) return Object.freeze([]);
    this.#assertMap(adapter, `plugins.${adapterKey}`);

    const endpoints = adapter.get('endpoints', true);
    if (endpoints === undefined) return Object.freeze([]);
    this.#assertSequence(endpoints, `plugins.${adapterKey}.endpoints`);

    return Object.freeze(endpoints.items.map((item, index) => {
      this.#assertMap(item, `plugins.${adapterKey}.endpoints[${index}]`);
      const value = item.toJSON() as Record<string, unknown>;
      if (typeof value.id !== 'string' || value.id.trim() === '') {
        throw new Error(`配置的 plugins.${adapterKey}.endpoints[${index}].id 必须是非空字符串`);
      }
      return Object.freeze(value as ConfiguredEndpointEntry);
    }));
  }

  add(request: AddConfiguredEndpointRequest): EndpointConfigurationMutation {
    const config = this.#readDocument(request.adapterKey);
    const endpoints = this.#ensureEndpoints(config.document, request.adapterKey);
    if (endpoints.items.some((item) => this.#entryId(item) === request.entry.id)) {
      throw new Error(
        `配置中已存在 ${request.adapterKey} endpoint「${request.entry.id}」，`
        + `可先 ${request.adapterKey} endpoint remove ${request.entry.id} 再重新添加`,
      );
    }
    endpoints.items.push(config.document.createNode(request.entry));

    const environmentEntries = Object.entries(request.environment);
    if (environmentEntries.length === 0) {
      fs.writeFileSync(config.filePath, config.document.toString());
      return Object.freeze({ filePath: config.filePath });
    }

    const envPath = path.join(this.#projectRoot, '.env');
    const envBefore = this.#readFile(envPath);
    let envContent = envBefore.content;
    for (const [key, value] of environmentEntries) {
      envContent = this.#upsertEnvLine(envContent, key, value);
    }

    try {
      fs.writeFileSync(config.filePath, config.document.toString());
      fs.writeFileSync(envPath, envContent);
    } catch (error) {
      this.#restoreFile(config.filePath, config.before);
      this.#restoreFile(envPath, envBefore);
      throw error;
    }
    for (const [key, value] of environmentEntries) this.#environment[key] = value;
    return Object.freeze({ filePath: config.filePath });
  }

  remove(adapterKey: string, endpointId: string): RemoveConfiguredEndpointResult {
    const config = this.#readDocument(adapterKey);
    const endpoints = this.#ensureEndpoints(config.document, adapterKey);
    const next = endpoints.items.filter((item) => this.#entryId(item) !== endpointId);
    if (next.length === endpoints.items.length) {
      return Object.freeze({ removed: false, filePath: config.filePath });
    }
    endpoints.items = next;
    fs.writeFileSync(config.filePath, config.document.toString());
    return Object.freeze({ removed: true, filePath: config.filePath });
  }

  #resolveConfigFile(adapterKey: string): string {
    const filePath = this.#configFile ?? path.join(this.#projectRoot, 'zhin.config.yml');
    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return filePath;
    throw new Error(
      `暂不支持写入 ${path.extname(filePath) || '该'} 配置文件，`
      + `请在 ${filePath} 的 plugins.${adapterKey}.endpoints 中手动维护`,
    );
  }

  #readDocument(adapterKey: string): EndpointConfigDocument {
    const filePath = this.#resolveConfigFile(adapterKey);
    const before = this.#readFile(filePath);
    const document = parseDocument(before.content || '{}');
    if (document.errors.length > 0) throw document.errors[0];
    this.#assertMap(document.contents, '根节点');
    return { filePath, before, document };
  }

  #ensureEndpoints(
    document: ReturnType<typeof parseDocument>,
    adapterKey: string,
  ): YAMLSeq {
    let plugins = document.get('plugins', true);
    if (plugins === undefined) {
      document.set('plugins', document.createNode({}));
      plugins = document.get('plugins', true);
    }
    this.#assertMap(plugins, 'plugins');

    let adapter = plugins.get(adapterKey, true);
    if (adapter === undefined) {
      plugins.set(adapterKey, document.createNode({}));
      adapter = plugins.get(adapterKey, true);
    }
    this.#assertMap(adapter, `plugins.${adapterKey}`);

    let endpoints = adapter.get('endpoints', true);
    if (endpoints === undefined) {
      adapter.set('endpoints', document.createNode([]));
      endpoints = adapter.get('endpoints', true);
    }
    this.#assertSequence(endpoints, `plugins.${adapterKey}.endpoints`);
    return endpoints;
  }

  #assertMap(value: unknown, pathLabel: string): asserts value is YAMLMap {
    if (!isMap(value)) {
      throw new Error(pathLabel === '根节点'
        ? '配置根节点必须是对象映射，请运行 zhin migrate 后再试'
        : `配置的 ${pathLabel} 必须是对象映射，请运行 zhin migrate 后再试`);
    }
  }

  #assertSequence(value: unknown, pathLabel: string): asserts value is YAMLSeq {
    if (!isSeq(value)) throw new Error(`配置的 ${pathLabel} 必须是数组`);
  }

  #entryId(item: unknown): string | undefined {
    if (!isMap(item)) return undefined;
    const id = item.get('id');
    return typeof id === 'string' && id ? id : undefined;
  }

  #readFile(filePath: string): FileSnapshot {
    const exists = fs.existsSync(filePath);
    return Object.freeze({
      exists,
      content: exists ? fs.readFileSync(filePath, 'utf8') : '',
    });
  }

  #restoreFile(filePath: string, snapshot: FileSnapshot): void {
    if (snapshot.exists) fs.writeFileSync(filePath, snapshot.content);
    else if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  #upsertEnvLine(content: string, key: string, value: string): string {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${escapedKey}\\s*=.*$`, 'mu');
    if (pattern.test(content)) return content.replace(pattern, line);
    const trimmed = content.replace(/\s*$/u, '');
    return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
  }
}
