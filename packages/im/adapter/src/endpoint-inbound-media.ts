/**
 * Inbound media directories and protocol-server origins an Endpoint owns (#1250).
 *
 * An inbound `MediaRef kind: 'path'` names a file on this host. The Agent reads one only when the
 * Endpoint that produced the message declared the directory it writes its own downloads into, and
 * the file's real path (symbolic links resolved) lies inside that directory. Every other local path
 * in an inbound message — a platform field, a parsed text code, a forwarded node — is never read.
 */
export interface EndpointInboundMediaPort {
  /**
   * Directories this Endpoint writes downloaded inbound media into (absolute, or relative to the
   * process working directory). Read at the time a Turn is built, so it may follow configuration.
   * Declare only directories the Endpoint itself fills; never a project, data or home directory.
   */
  roots?(): readonly string[];
  /**
   * #1250 第 48 批: the protocol server this Endpoint is configured to talk to (`https://host:5140`,
   * `ws://host:3001`, …), when it hands out media URLs on its own port. A media download from a
   * platform message then keeps that exact origin's port; every other non-default port is still
   * refused, and the private-host and scheme checks still apply. Declare only the server address from
   * the Endpoint's own configuration, never an address taken from a message.
   */
  origins?(): readonly string[];
}

/** The Endpoint's inbound media port; a missing, malformed or throwing declaration is none. */
export function endpointInboundMediaOf(endpoint: unknown): EndpointInboundMediaPort | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  try {
    const port = (endpoint as { readonly inboundMedia?: unknown }).inboundMedia;
    if (!port || typeof port !== 'object') return undefined;
    const declared = port as { readonly roots?: unknown; readonly origins?: unknown };
    return typeof declared.roots === 'function' || typeof declared.origins === 'function'
      ? port as EndpointInboundMediaPort
      : undefined;
  } catch {
    return undefined;
  }
}

/** The declared roots, trimmed; a malformed or throwing port declares none. */
export function endpointInboundMediaRoots(endpoint: unknown): readonly string[] {
  const port = endpointInboundMediaOf(endpoint);
  if (!port?.roots) return Object.freeze([]);
  try {
    const roots = port.roots();
    if (!Array.isArray(roots)) return Object.freeze([]);
    return Object.freeze(roots.filter((root): root is string => typeof root === 'string' && root.trim() !== '')
      .map(root => root.trim()));
  } catch {
    return Object.freeze([]);
  }
}

const ORIGIN_SCHEMES: Readonly<Record<string, string>> = Object.freeze({ 'http:': 'http:', 'https:': 'https:', 'ws:': 'http:', 'wss:': 'https:' });

/**
 * The declared protocol-server origins as `URL.origin` writes them (`ws:` → `http:`, `wss:` → `https:`,
 * default ports dropped), without duplicates; anything that is not an http(s) / ws(s) URL, or a
 * malformed or throwing port, declares none.
 */
export function endpointInboundMediaOrigins(endpoint: unknown): readonly string[] {
  const port = endpointInboundMediaOf(endpoint);
  if (!port?.origins) return Object.freeze([]);
  try {
    const declared = port.origins();
    if (!Array.isArray(declared)) return Object.freeze([]);
    const origins = new Set<string>();
    for (const value of declared) {
      if (typeof value !== 'string' || !value.trim()) continue;
      let url: URL;
      try { url = new URL(value.trim()); } catch { continue; }
      const scheme = ORIGIN_SCHEMES[url.protocol];
      if (!scheme || !url.hostname) continue;
      if (scheme !== url.protocol) url = new URL(`${scheme}//${url.host}`);
      origins.add(url.origin);
    }
    return Object.freeze([...origins]);
  } catch {
    return Object.freeze([]);
  }
}
