/** Plugin instance configuration (`schema.json`), with defaults and safe bounds. */
export interface RouletteConfig {
  /** Chambers in the cylinder; one holds the bullet. */
  readonly chambers: number;
  readonly maxPlayers: number;
  /** The player on turn loses when they do not fire within this time. */
  readonly turnTimeoutSeconds: number;
  /** A lobby that never starts is dissolved after this time. */
  readonly lobbyTimeoutSeconds: number;
  /** Mute length for the loser, used only in groups that enabled the mute penalty. */
  readonly muteSeconds: number;
}

interface IntegerBounds {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

const CONFIG_BOUNDS: Readonly<Record<keyof RouletteConfig, IntegerBounds>> = {
  chambers: { fallback: 6, min: 2, max: 12 },
  maxPlayers: { fallback: 6, min: 2, max: 10 },
  turnTimeoutSeconds: { fallback: 60, min: 10, max: 600 },
  lobbyTimeoutSeconds: { fallback: 300, min: 30, max: 3600 },
  muteSeconds: { fallback: 60, min: 10, max: 3600 },
};

export const DEFAULT_ROULETTE_CONFIG: RouletteConfig = resolveRouletteConfig(undefined);

export function resolveRouletteConfig(raw: unknown): RouletteConfig {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.freeze({
    chambers: readInteger(source.chambers, CONFIG_BOUNDS.chambers),
    maxPlayers: readInteger(source.maxPlayers, CONFIG_BOUNDS.maxPlayers),
    turnTimeoutSeconds: readInteger(source.turnTimeoutSeconds, CONFIG_BOUNDS.turnTimeoutSeconds),
    lobbyTimeoutSeconds: readInteger(source.lobbyTimeoutSeconds, CONFIG_BOUNDS.lobbyTimeoutSeconds),
    muteSeconds: readInteger(source.muteSeconds, CONFIG_BOUNDS.muteSeconds),
  });
}

function readInteger(value: unknown, bounds: IntegerBounds): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return bounds.fallback;
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return value;
}
