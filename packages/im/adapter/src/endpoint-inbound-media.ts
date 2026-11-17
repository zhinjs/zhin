/**
 * Inbound media directories an Endpoint owns (#1250).
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
  roots(): readonly string[];
}

/** The Endpoint's inbound media port; a missing, malformed or throwing declaration is none. */
export function endpointInboundMediaOf(endpoint: unknown): EndpointInboundMediaPort | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  try {
    const port = (endpoint as { readonly inboundMedia?: unknown }).inboundMedia;
    if (!port || typeof port !== 'object') return undefined;
    return typeof (port as { readonly roots?: unknown }).roots === 'function'
      ? port as EndpointInboundMediaPort
      : undefined;
  } catch {
    return undefined;
  }
}

/** The declared roots, trimmed; a malformed or throwing port declares none. */
export function endpointInboundMediaRoots(endpoint: unknown): readonly string[] {
  const port = endpointInboundMediaOf(endpoint);
  if (!port) return Object.freeze([]);
  try {
    const roots = port.roots();
    if (!Array.isArray(roots)) return Object.freeze([]);
    return Object.freeze(roots.filter((root): root is string => typeof root === 'string' && root.trim() !== '')
      .map(root => root.trim()));
  } catch {
    return Object.freeze([]);
  }
}
