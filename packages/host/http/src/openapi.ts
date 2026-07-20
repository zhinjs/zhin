export type OpenApiParameter = {
  readonly name: string;
  readonly in: 'query' | 'path' | 'header';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: Record<string, unknown>;
};

export type RouteMeta = {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly parameters?: readonly OpenApiParameter[];
  readonly responses?: Record<string, unknown>;
  readonly requestBody?: Record<string, unknown>;
};

export type ListedRoute = {
  readonly method: string;
  readonly pattern: string;
  readonly meta?: RouteMeta;
};

export type BuildOpenApiOptions = {
  readonly title?: string;
  readonly version?: string;
  readonly apiBase?: string;
  readonly serverUrl?: string;
};

export function patternToOpenApiPath(pattern: string): string {
  return pattern
    .replace(/\/\*$/u, '/{path}')
    .replace(/:([A-Za-z0-9_]+)\+/gu, '{$1}')
    .replace(/\*([A-Za-z0-9_]+)/gu, '{$1}')
    .replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
}

export function routeRequiresBearerAuth(pathname: string, apiBase: string): boolean {
  if (pathname.startsWith('/pub/') || pathname === '/pub') return false;
  if (pathname.includes('/webhook')) return false;
  if (!pathname.startsWith(`${apiBase}/`) && pathname !== apiBase) return false;
  return true;
}

function defaultOperationId(method: string, pattern: string): string {
  const slug = pattern
    .replace(/^\//u, '')
    .replace(/[{}]/gu, '')
    .replace(/[/:*]/gu, '_')
    .replace(/[^a-zA-Z0-9_]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_|_$/gu, '');
  return `${method.toLowerCase()}_${slug || 'root'}`;
}

function inferTag(pattern: string, apiBase: string): string | undefined {
  const rest = pattern.startsWith(`${apiBase}/`)
    ? pattern.slice(apiBase.length + 1)
    : pattern.replace(/^\//u, '');
  const seg = rest.split('/')[0];
  if (!seg || seg === 'pub') return undefined;
  if (seg === 'console') return 'console';
  return seg;
}

function buildOperation(route: ListedRoute, apiBase: string): Record<string, unknown> {
  const { method, pattern, meta } = route;
  const op: Record<string, unknown> = {
    operationId: meta?.operationId ?? defaultOperationId(method, pattern),
    summary: meta?.summary ?? `${method} ${pattern}`,
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  };
  if (meta?.description) op.description = meta.description;
  if (meta?.deprecated) op.deprecated = true;

  const tags = meta?.tags?.length
    ? [...meta.tags]
    : [inferTag(pattern, apiBase)].filter(Boolean);
  if (tags.length) op.tags = tags;

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    op.requestBody = {
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
        },
      },
    };
  }

  const pathParams = [...pattern.matchAll(/:([A-Za-z0-9_]+)/gu)].map((match) => ({
    name: match[1],
    in: 'path' as const,
    required: true,
    schema: { type: 'string' },
  }));
  if (pattern.endsWith('/*')) {
    pathParams.push({
      name: 'path',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }
  const allParams = [...pathParams, ...(meta?.parameters ?? [])];
  if (allParams.length) op.parameters = allParams;
  if (meta?.responses) op.responses = meta.responses;
  if (meta?.requestBody) op.requestBody = meta.requestBody;

  if (routeRequiresBearerAuth(pattern.replace(/\/\*$/u, ''), apiBase)
    || routeRequiresBearerAuth(pattern, apiBase)) {
    op.security = [{ bearerAuth: [] }];
  }

  return op;
}

export function buildOpenApiDocument(
  routes: readonly ListedRoute[],
  options: BuildOpenApiOptions = {},
): Record<string, unknown> {
  const apiBase = options.apiBase ?? '/api';
  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  const sorted = [...routes].sort(
    (left, right) => left.pattern.localeCompare(right.pattern)
      || left.method.localeCompare(right.method),
  );

  for (const route of sorted) {
    const key = `${route.method}\0${route.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const oaPath = patternToOpenApiPath(route.pattern);
    if (!paths[oaPath]) paths[oaPath] = {};
    paths[oaPath][route.method.toLowerCase()] = buildOperation(route, apiBase);
  }

  const doc: Record<string, unknown> = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Zhin Plugin Runtime Host',
      version: options.version ?? '0.0.0',
      description:
        'Runtime route catalog for @zhin.js/host-http. Register routes via HttpHost.route().',
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Set `Authorization: Bearer <http.token>` for paths under the API base.',
        },
      },
    },
  };
  if (options.serverUrl) doc.servers = [{ url: options.serverUrl }];
  return doc;
}
