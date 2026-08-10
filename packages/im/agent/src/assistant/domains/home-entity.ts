/**
 * HA entity_id helpers (domain parsing shared by policy / facade / backend).
 */

export function parseEntityDomain(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot > 0 ? entityId.slice(0, dot) : entityId;
}
