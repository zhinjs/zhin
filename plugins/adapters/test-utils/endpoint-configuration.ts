import type {
  AddConfiguredEndpointRequest,
  ConfiguredEndpointEntry,
  EndpointConfigurationStore,
} from 'zhin.js/adapter';

/** In-memory project configuration port for platform adapter tests. */
export class MemoryEndpointConfigurationStore implements EndpointConfigurationStore {
  readonly entries = new Map<string, ConfiguredEndpointEntry[]>();
  readonly environment = new Map<string, string>();

  constructor(readonly filePath = '/project/zhin.config.yml') {}

  list(adapterKey: string): readonly ConfiguredEndpointEntry[] {
    return this.entries.get(adapterKey) ?? [];
  }

  seed(adapterKey: string, entries: readonly ConfiguredEndpointEntry[]): void {
    this.entries.set(adapterKey, [...entries]);
  }

  environmentText(): string {
    return [...this.environment]
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  configurationText(adapterKey: string): string {
    return this.list(adapterKey)
      .flatMap((entry) => Object.entries(entry).map(([key, value]) => (
        `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`
      )))
      .join('\n');
  }

  add(request: AddConfiguredEndpointRequest) {
    const entries = this.entries.get(request.adapterKey) ?? [];
    if (entries.some((entry) => entry.id === request.entry.id)) {
      throw new Error(`配置中已存在 ${request.adapterKey} endpoint「${request.entry.id}」`);
    }
    entries.push(request.entry);
    this.entries.set(request.adapterKey, entries);
    for (const [key, value] of Object.entries(request.environment)) {
      this.environment.set(key, value);
    }
    return { filePath: this.filePath };
  }

  remove(adapterKey: string, endpointId: string) {
    const entries = this.entries.get(adapterKey) ?? [];
    const next = entries.filter((entry) => entry.id !== endpointId);
    this.entries.set(adapterKey, next);
    return {
      removed: next.length !== entries.length,
      filePath: this.filePath,
    };
  }
}
