/** OpenAPI parameter object (subset). */
export type OpenApiParameter = {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
};

/** Optional metadata for OpenAPI operation generation (plugin routes). */
export type RouteMeta = {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  /** Merged with path params from URL pattern */
  parameters?: OpenApiParameter[];
  /** Overrides default `{ 200: generic object }` */
  responses?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
};

export function isRouteMeta(value: unknown): value is RouteMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    "summary" in o ||
    "description" in o ||
    "tags" in o ||
    "operationId" in o ||
    "deprecated" in o ||
    "parameters" in o ||
    "responses" in o ||
    "requestBody" in o
  );
}
