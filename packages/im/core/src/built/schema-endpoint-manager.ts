import type { Schema } from '@zhin.js/schema';
import { Adapter } from '../adapter.js';
import { Prompt } from '../prompt.js';
import type { ConfigFeature } from './config.js';
import type {
  EndpointConfigRecord,
  EndpointManager,
  ProvisionContext,
} from './endpoint-manager.js';

function readConfigEndpoints(root: import('../plugin.js').Plugin, context: string): EndpointConfigRecord[] {
  const configService = root.inject('config') as ConfigFeature | undefined;
  const raw = configService?.getRaw<{ endpoints?: EndpointConfigRecord[] }>(
    configService.primaryFile,
  );
  return (raw?.endpoints ?? []).filter((e) => e.context === context);
}

export class SchemaEndpointManager implements EndpointManager {
  constructor(
    private readonly adapter: Adapter,
    private readonly schema: Schema,
  ) {}

  supportsProvision(): boolean {
    return true;
  }

  listEndpoints(): EndpointConfigRecord[] {
    return readConfigEndpoints(this.adapter.plugin.root, String(this.adapter.name));
  }

  async addEndpoint(ctx: ProvisionContext): Promise<EndpointConfigRecord> {
    const prompt = new Prompt(this.adapter.plugin, ctx.message);
    await ctx.onStatusUpdate(`请按提示填写 ${String(this.adapter.name)} endpoint 配置：`);
    const name = await prompt.text('Endpoint 名称（zhin.config endpoints[].name）：');
    const fields = await prompt.getValueWithSchema(this.schema);
    return {
      context: String(this.adapter.name),
      name: name.trim(),
      ...(fields as Record<string, unknown>),
    };
  }

  async editEndpoint(name: string, ctx: ProvisionContext): Promise<EndpointConfigRecord> {
    const existing = this.listEndpoints().find((e) => e.name === name);
    if (!existing) {
      throw new Error(`配置中不存在 ${String(this.adapter.name)}/${name}`);
    }
    await ctx.onStatusUpdate(`编辑 ${String(this.adapter.name)}/${name}，留空字段将保留原值。`);
    const prompt = new Prompt(this.adapter.plugin, ctx.message);
    const fields = await prompt.getValueWithSchema(this.schema);
    return {
      ...existing,
      ...(fields as Record<string, unknown>),
      context: String(this.adapter.name),
      name,
    };
  }

  async removeEndpoint(name: string): Promise<boolean> {
    return this.listEndpoints().some((e) => e.name === name);
  }

  async startEndpoint(name: string, ctx: ProvisionContext): Promise<void> {
    const rec = this.listEndpoints().find((e) => e.name === name);
    if (!rec) throw new Error(`配置中不存在 ${String(this.adapter.name)}/${name}`);
    await ctx.onStatusUpdate(`正在连接 ${String(this.adapter.name)}/${name}…`);
  }

  async stopEndpoint(name: string): Promise<boolean> {
    return this.adapter.endpoints.has(name);
  }
}

export function resolveEndpointManager(adapter: Adapter): EndpointManager | null {
  const custom = adapter.getEndpointManager?.();
  if (custom) return custom;

  const schema =
    adapter.getEndpointConfigSchema?.() ??
    (adapter.constructor as typeof Adapter & { endpointConfigSchema?: Schema }).endpointConfigSchema;
  if (schema) {
    return new SchemaEndpointManager(adapter, schema);
  }
  return null;
}

export function adapterSupportsProvision(adapter: Adapter): boolean {
  const manager = resolveEndpointManager(adapter);
  return manager?.supportsProvision() ?? false;
}
