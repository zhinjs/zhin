/** Module-level SessionService holder for Plugin Runtime setup()/commands. */
let services: unknown | null = null;

export function getGameServices<T>(): T | null {
  return (services as T | null) ?? null;
}

export function setGameServices(value: unknown | null): void {
  services = value;
}
