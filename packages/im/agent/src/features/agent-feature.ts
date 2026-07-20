/**
 * AgentFeature — 专长 / 子代理预设（装配面；ADR 0042）
 *
 * 不等同于配置 `agents[].match` 主绑定；主路径选用由 Agent Binding 决定。
 * Core `AgentPresetFeature` 仍保留；本 Feature 为 agent 包权威装配面。
 */

import { Feature, type FeatureJSON } from '@zhin.js/kernel';
import type { AgentPreset } from '../orchestrator/types.js';

export class AgentFeature extends Feature<AgentPreset> {
  readonly name = 'agentFeature' as const;
  readonly icon = 'Bot';
  readonly desc = 'Agent 专长预设';

  readonly byName = new Map<string, AgentPreset>();
  /** Bumped when presets change — Capability Ingress cache invalidation. */
  epoch = 0;

  add(preset: AgentPreset, pluginName: string): () => void {
    this.byName.set(preset.name, preset);
    this.epoch++;
    return super.add(preset, pluginName);
  }

  remove(preset: AgentPreset, pluginName?: string): boolean {
    this.byName.delete(preset.name);
    this.epoch++;
    return super.remove(preset, pluginName);
  }

  get(name: string): AgentPreset | undefined {
    return this.byName.get(name);
  }

  getAll(): AgentPreset[] {
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
      items: list.map((p) => ({
        name: p.name,
        desc: p.description,
        model: p.model,
        pluginName: p.pluginName,
      })),
    };
  }
}
