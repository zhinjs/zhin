/** Optional metadata for OpenAPI operation generation (plugin routes). */
export type RouteMeta = {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
};

export function isRouteMeta(value: unknown): value is RouteMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    "summary" in o ||
    "description" in o ||
    "tags" in o ||
    "operationId" in o ||
    "deprecated" in o
  );
}
