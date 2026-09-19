import type { RuntimeConfigDocument } from '@zhin.js/runtime';
import {
  flattenConfigDocument,
  listConsoleConfigKeys,
  readProjectConfigDocument,
  readProjectConfigYaml,
  writeProjectConfigKey,
  writeProjectConfigYaml,
} from './configuration-document.js';
import { readEnvFile, writeEnvFile } from './environment-files.js';
import { readPluginSchema, readPluginSchemas } from './plugin-schema.js';

/** Owns one project's Console configuration I/O and serializes mutations. */
export class ConsoleConfigurationStore {
  readonly #projectRoot: string;
  #writeTail: Promise<unknown> = Promise.resolve();

  constructor(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  readYaml(): Promise<string> {
    return readProjectConfigYaml(this.#projectRoot);
  }

  async readDocument(): Promise<Record<string, unknown>> {
    return flattenConfigDocument(await readProjectConfigDocument(this.#projectRoot));
  }

  writeYaml(yaml: string): Promise<void> {
    return writeProjectConfigYaml(this.#projectRoot, yaml);
  }

  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }> {
    const run = this.#writeTail.then(
      () => writeProjectConfigKey(this.#projectRoot, pluginName, data),
      () => writeProjectConfigKey(this.#projectRoot, pluginName, data),
    );
    this.#writeTail = run.catch(() => undefined);
    return run;
  }

  readEnvironmentFile(filename: string): Promise<string> {
    return readEnvFile(this.#projectRoot, filename);
  }

  writeEnvironmentFile(filename: string, content: string): Promise<void> {
    return writeEnvFile(this.#projectRoot, filename, content);
  }

  readSchema(pluginName?: string): Promise<unknown> {
    return readPluginSchema(this.#projectRoot, pluginName);
  }

  async readAllSchemas(): Promise<Record<string, unknown>> {
    const keys = await listConsoleConfigKeys(this.#projectRoot);
    return readPluginSchemas(this.#projectRoot, keys);
  }

  listKeys(primaryConfigDocument?: RuntimeConfigDocument): Promise<string[]> {
    return listConsoleConfigKeys(this.#projectRoot, primaryConfigDocument);
  }
}
