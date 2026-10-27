/**
 * 从 Host 取控制面给危险工具硬闸（ADR 0036 §2 / §3，#1008）。
 *
 * `ZhinAgent` 暴露 `controlPlane`（以及 `getControlPlane()`）；自定义 Host 可以都没有，此时不做控制面判定，
 * 与入站 / 出站控制面闸「未接控制面时放行」一致。返回的是取值函数：每次判定现读，回合中途开关变化也生效。
 */
import type { ToolHardGateControlSource, ToolHardGateControlView } from './tool-hard-gate.js';

interface HostWithControlPlane {
  readonly controlPlane?: ToolHardGateControlView;
  getControlPlane?(): ToolHardGateControlView | undefined;
}

export function hostControlPlaneSource(host: object): ToolHardGateControlSource | undefined {
  const candidate = host as HostWithControlPlane;
  if (typeof candidate.getControlPlane === 'function') {
    return () => candidate.getControlPlane?.();
  }
  if (candidate.controlPlane && typeof candidate.controlPlane.isEmergencyStopped === 'function') {
    return () => candidate.controlPlane;
  }
  return undefined;
}
