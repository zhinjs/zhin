import type { AiControlPlane, SelfChangeApplyPorts, SelfChangeRecord, SelfChangeReportOutcome } from '@zhin.js/agent';

/**
 * ADR 0040 §6 (slice E2): the Agent generation's half of the self-change apply ports.
 *
 * - `report`: one line back to the conversation that started the change (`reportTarget`). It passes the control
 *   plane like any outbound message — blocked → `blocked` (audited, the change keeps its state). When the
 *   conversation is unreachable (send fails: gone, Bot left the group, muted) it goes to the Endpoint owner's
 *   private chat instead (`redirected`). `ownerOnly` reports (emergency stop) go straight to the owner and are
 *   not held by the control plane: they announce the emergency stop that would otherwise swallow them.
 * - `emergencyStop`: turns on the instance-level `emergency_stop` switch (ADR 0036) as `self_change:<id>`.
 */
export interface SelfChangeReportTarget {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: Readonly<{ kind: 'private' | 'group' | 'channel'; id: string }>;
}

export interface SelfChangeGenerationPortOptions {
  readonly send: (target: SelfChangeReportTarget, text: string) => Promise<unknown>;
  readonly resolveOwner?: (platform: string, endpointKey: string) => string | undefined;
  readonly control: () => Pick<AiControlPlane, 'outboundGate' | 'snapshot' | 'set'> | undefined;
  readonly onError?: (error: unknown) => void;
}

export function createSelfChangeGenerationPorts(
  options: SelfChangeGenerationPortOptions,
): Pick<SelfChangeApplyPorts, 'emergencyStop' | 'report'> {
  const onError = options.onError ?? (() => undefined);
  const owner = (platform: string, endpointKey: string): string | undefined => {
    try {
      return options.resolveOwner?.(platform, endpointKey)?.trim() || undefined;
    } catch {
      return undefined;
    }
  };
  return Object.freeze({
    async report({ text, target, ownerOnly }): Promise<SelfChangeReportOutcome> {
      const endpointKey = target.endpoint?.trim();
      if (!endpointKey) return 'failed';
      if (!ownerOnly) {
        const conversation = parseScene(target.sceneId);
        if (conversation) {
          const control = options.control();
          if (control) {
            let blocked: boolean;
            try {
              blocked = control.outboundGate(target.platform, target.sceneId).blocked;
            } catch {
              blocked = true;
            }
            if (blocked) return 'blocked';
          }
          try {
            await options.send({ adapter: target.platform, endpointKey, conversation }, text);
            return 'sent';
          } catch (error) {
            onError(error);
          }
        }
      }
      const ownerId = owner(target.platform, endpointKey);
      if (!ownerId) return 'failed';
      try {
        await options.send({ adapter: target.platform, endpointKey, conversation: { kind: 'private', id: ownerId } }, text);
        return ownerOnly ? 'sent' : 'redirected';
      } catch (error) {
        onError(error);
        return 'failed';
      }
    },
    async emergencyStop(record: SelfChangeRecord): Promise<void> {
      const control = options.control();
      if (!control) throw new Error('control plane is unavailable; emergency_stop was not turned on');
      const input = { instance: { emergency_stop: true }, actorId: `self_change:${record.id}` } as const;
      try {
        await control.set({ ...input, expectedRevision: control.snapshot().revision });
      } catch {
        // A concurrent Console write moved the revision: re-read once.
        await control.set({ ...input, expectedRevision: control.snapshot().revision });
      }
    },
  });
}

/** `<scope>:<id>` → conversation; unknown scope → null (reported to the owner instead). */
function parseScene(sceneId: string): SelfChangeReportTarget['conversation'] | null {
  const split = sceneId.indexOf(':');
  if (split <= 0) return null;
  const kind = sceneId.slice(0, split);
  const id = sceneId.slice(split + 1);
  if (!id || (kind !== 'private' && kind !== 'group' && kind !== 'channel')) return null;
  return { kind, id };
}
