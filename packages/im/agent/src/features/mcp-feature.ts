/**
 * MCPFeature — MCP server 声明（装配面；ADR 0042）
 *
 * 仅存连接声明，不含已连接后的工具列表。
 */

import { Feature, type FeatureJSON } from '@zhin.js/kernel';
import type { McpServerEntry } from '../orchestrator/types.js';

export interface McpFeatureEntry extends McpServerEntry {
  /** 来源插件或 config */
  pluginName?: string;
}

export class MCPFeature extends Feature<McpFeatureEntry> {
  readonly name = 'mcpFeature' as const;
  readonly icon = 'Plug';
  readonly desc = 'MCP 服务声明';

  readonly byName = new Map<string, McpFeatureEntry>();
  epoch = 0;

  add(entry: McpFeatureEntry, pluginName: string): () => void {
    const withPlugin: McpFeatureEntry = {
      ...entry,
      pluginName: entry.pluginName ?? pluginName,
    };
    this.byName.set(withPlugin.name, withPlugin);
    this.epoch++;
    return super.add(withPlugin, pluginName);
  }

  remove(entry: McpFeatureEntry, pluginName?: string): boolean {
    this.byName.delete(entry.name);
    this.epoch++;
    return super.remove(entry, pluginName);
  }

  get(name: string): McpFeatureEntry | undefined {
    return this.byName.get(name);
  }

  getAll(): McpFeatureEntry[] {
    return [...this.items];
  }

  dispose(): void {
    this.byName.clear();
    this.epoch++;
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map((e) => ({
        name: e.name,
        desc: e.transport,
        pluginName: e.pluginName,
      })),
    };
  }
}
