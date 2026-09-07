import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { databaseHostToken, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { primaryConfigToken, type PrimaryConfig } from '@zhin.js/runtime';
import type { HttpHost } from '@zhin.js/host-http';

export interface ReadinessPolicy {
  readonly database?: boolean;
  readonly endpoints?: readonly { readonly owner: string; readonly name: string }[];
  readonly agents?: readonly string[];
}

export interface ReadinessCheck {
  readonly component: string;
  readonly ready: boolean;
  readonly reason: string;
  readonly remediation?: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly generation?: number;
  readonly checkedAt: string;
  readonly checks: readonly ReadinessCheck[];
}

export interface ReadinessSource {
  readonly snapshots: SnapshotReader;
  /** Reads only bindings from the supplied generation; never calls a provider. */
  readonly agentBindings?: (snapshot: RuntimeSnapshot) => readonly { readonly name: string }[];
}

/** One request, one lease. No network IO or cached latest-generation state. */
export function readReadiness(source: ReadinessSource): ReadinessReport {
  const checkedAt = new Date().toISOString();
  let lease: ReturnType<SnapshotReader['acquire']> | undefined;
  try {
    lease = source.snapshots.acquire();
    const snapshot = lease.value;
    const resources = snapshot.resources.get(snapshot.root);
    const config = resources?.get(primaryConfigToken.id) as PrimaryConfig | undefined;
    if (!config || snapshot.generation === 0) {
      return { ready: false, checkedAt, checks: [{
        component: 'runtime', ready: false, reason: 'generation_not_committed',
        remediation: 'Check startup logs and resolve configuration or plugin activation errors.',
      }] };
    }
    const policy = config.get<{ readiness?: ReadinessPolicy }>('http')?.readiness ?? {};
    const checks: ReadinessCheck[] = [{ component: 'runtime', ready: true, reason: 'generation_committed' }];
    if (policy.database !== false) {
      const database = resources?.get(databaseHostToken.id) as { readonly started: boolean } | undefined;
      const ready = database?.started === true;
      checks.push({ component: 'database', ready, reason: ready ? 'initialized' : 'not_initialized',
        ...(!ready ? { remediation: 'Check Database Host startup and configured dialect dependencies.' } : {}),
      });
    }
    const index = snapshot.projections.get(adapterFeatureId);
    const endpoints = isAdapterIndex(index) ? index.describe() : [];
    for (const required of policy.endpoints ?? []) {
      // Use the manifest owner and stable slot id, never a platform's mutable display name.
      const endpoint = endpoints.find((row) => row.owner === required.owner
        && String(row.id).split('\0').at(-1) === required.name);
      const ready = endpoint?.connected === true;
      checks.push({ component: `endpoint:${required.owner}:${required.name}`, ready,
        reason: ready ? 'admission_open' : endpoint ? 'admission_closed' : 'endpoint_missing',
        ...(!ready ? { remediation: 'Check the plugin instance, endpoint slot and activation logs.' } : {}),
      });
    }
    if (policy.agents?.length) {
      const bindings = source.agentBindings?.(snapshot) ?? [];
      for (const name of policy.agents) {
        const ready = bindings.some((binding) => binding.name === name);
        checks.push({ component: `agent:${name}`, ready,
          reason: ready ? 'binding_configured' : 'binding_missing',
          ...(!ready ? { remediation: 'Enable the Agent Host and configure this agent binding.' } : {}),
        });
      }
    }
    return { ready: checks.every((check) => check.ready), generation: snapshot.generation, checkedAt, checks };
  } catch {
    // Exception text may contain credentials, SQL or filesystem paths.
    return { ready: false, checkedAt, checks: [{
      component: 'runtime', ready: false, reason: 'diagnostic_unavailable',
      remediation: 'Check runtime logs; the Root may be starting or stopping.',
    }] };
  } finally {
    lease?.release();
  }
}

/** Process routes remain available before first commit and across generation replacement. */
export function registerReadinessRoutes(http: HttpHost, source: ReadinessSource, apiBase = '/api'): () => void {
  const base = `/${apiBase.split('/').filter(Boolean).join('/')}`;
  const disposePublic = http.route('GET', '/pub/ready', (_request, response) => {
    const report = readReadiness(source);
    response.statusCode = report.ready ? 200 : 503;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ ready: report.ready }));
  }, { summary: 'Runtime readiness (no external network probes)', tags: ['pub'] });
  const disposeDetails = http.route('GET', `${base}/system/readiness`, (_request, response, _url, scope) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (scope !== 'full') {
      response.statusCode = 403;
      response.end(JSON.stringify({ success: false, error: 'Full scope required' }));
      return;
    }
    const report = readReadiness(source);
    response.statusCode = report.ready ? 200 : 503;
    response.end(JSON.stringify({ success: report.ready, data: report }));
  }, { summary: 'Required runtime components and remediation', tags: ['system'] });
  return () => { disposePublic(); disposeDetails(); };
}
