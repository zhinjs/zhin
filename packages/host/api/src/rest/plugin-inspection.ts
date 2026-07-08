import { Feature, type Plugin } from "@zhin.js/core";
import type { FeatureJSON } from "@zhin.js/kernel";

export type PluginContextSummary = {
  name: string;
  description?: string;
};

/** 根插件上已 provide 的 Feature 服务（command / tool / …） */
export function collectFeatureServices(root: Plugin): Feature[] {
  const features: Feature[] = [];
  for (const [, context] of root.contexts) {
    if (context.value instanceof Feature) {
      features.push(context.value);
    }
  }
  return features;
}

/** 仅统计该插件自身 provide 的 context（不含子插件聚合） */
export function collectOwnContexts(plugin: Plugin): PluginContextSummary[] {
  const summaries: PluginContextSummary[] = [];
  for (const [name, ctx] of plugin.$contexts) {
    summaries.push({ name, description: ctx.description });
  }
  return summaries;
}

export function contextFeatureJSON(
  contexts: PluginContextSummary[],
): FeatureJSON | undefined {
  if (contexts.length === 0) return undefined;
  return {
    name: "context",
    icon: "Database",
    desc: "上下文",
    count: contexts.length,
    items: contexts.map((c) => ({
      name: c.name,
      desc: c.description,
    })),
  };
}

/** Feature 分组 + 合成 context 分组（供 Console 卡片展示） */
export function buildPluginFeatures(
  plugin: Plugin,
  featureServices: Feature[],
): FeatureJSON[] {
  const features = featureServices
    .map((f) => f.toJSON(plugin.name))
    .filter((f) => f.count > 0);
  const ctxFeature = contextFeatureJSON(collectOwnContexts(plugin));
  if (ctxFeature) features.push(ctxFeature);
  return features;
}

export function buildPluginListItem(
  plugin: Plugin,
  featureServices: Feature[],
) {
  const contexts = collectOwnContexts(plugin);
  return {
    name: plugin.name,
    status: plugin.started ? ("active" as const) : ("inactive" as const),
    description:
      (plugin.manifest as { description?: string } | undefined)?.description ||
      plugin.name,
    features: buildPluginFeatures(plugin, featureServices),
    contextCount: contexts.length,
    contexts,
  };
}
