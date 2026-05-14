import { formatGlueInstanceKey, type BridgeGlueInstanceKey } from '@zhin.js/bridge-supervisor'

const failureStreak = new Map<string, number>()

export function circuitKeyForGlue(key: BridgeGlueInstanceKey): string {
  return formatGlueInstanceKey(key)
}

export function resetCircuitFailureStreak(mapKey: string): void {
  failureStreak.set(mapKey, 0)
}

/**
 * Increments failure count; when `threshold` is reached, runs `onTrip`, then resets the streak.
 * @returns whether a trip (restart) was invoked
 */
export async function recordBridgeGlueFailureAndMaybeTrip(options: {
  mapKey: string
  threshold: number
  onTrip: () => Promise<unknown> | unknown
}): Promise<boolean> {
  const { mapKey, threshold, onTrip } = options
  const next = (failureStreak.get(mapKey) ?? 0) + 1
  failureStreak.set(mapKey, next)
  if (next < threshold) {
    return false
  }
  failureStreak.set(mapKey, 0)
  await onTrip()
  return true
}
