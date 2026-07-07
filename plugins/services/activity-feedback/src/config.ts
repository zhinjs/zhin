import type { ActivityFeedbackConfig } from '@zhin.js/agent';

/** 顶层 `activityFeedback` 配置（zhin.config.yml，与 endpoints 解耦） */
export interface ActivityFeedbackServiceConfig {
  enabled?: boolean;
  defaults?: ActivityFeedbackConfig;
  platforms?: Record<string, ActivityFeedbackConfig>;
  endpoints?: Record<string, ActivityFeedbackConfig>;
}

function mergePhaseScene(
  base: ActivityFeedbackConfig['phases'],
  override: ActivityFeedbackConfig['phases'],
): ActivityFeedbackConfig['phases'] {
  if (!base && !override) return undefined;
  const phases = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(override ?? {}),
  ]) as Set<keyof NonNullable<ActivityFeedbackConfig['phases']>>;

  const merged: NonNullable<ActivityFeedbackConfig['phases']> = {};
  for (const phase of phases) {
    merged[phase] = {
      ...base?.[phase],
      ...override?.[phase],
      private: { ...base?.[phase]?.private, ...override?.[phase]?.private },
      group: { ...base?.[phase]?.group, ...override?.[phase]?.group },
      channel: { ...base?.[phase]?.channel, ...override?.[phase]?.channel },
    };
  }
  return merged;
}

export function mergeActivityFeedbackLayers(
  ...layers: (ActivityFeedbackConfig | undefined)[]
): ActivityFeedbackConfig | undefined {
  let result: ActivityFeedbackConfig | undefined;
  for (const layer of layers) {
    if (!layer) continue;
    if (!result) {
      result = { ...layer, phases: layer.phases ? { ...layer.phases } : undefined };
      continue;
    }
    if (layer.enabled !== undefined) result.enabled = layer.enabled;
    if (layer.phases) {
      result.phases = mergePhaseScene(result.phases, layer.phases);
    }
  }
  return result;
}

export function loadActivityFeedbackServiceConfig(
  raw: ActivityFeedbackServiceConfig | undefined,
): ActivityFeedbackServiceConfig {
  return {
    enabled: true,
    ...raw,
  };
}

/** @deprecated 使用 ActivityFeedbackPolicy */
export function resolveActivityFeedbackForTarget(
  service: ActivityFeedbackServiceConfig,
  platform: string,
  endpointId: string,
): ActivityFeedbackConfig | undefined {
  if (service.enabled === false) {
    return { enabled: false };
  }
  return mergeActivityFeedbackLayers(
    service.defaults,
    service.platforms?.[platform],
    service.endpoints?.[`${platform}:${endpointId}`],
  );
}
