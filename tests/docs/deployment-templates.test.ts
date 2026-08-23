import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templateRoot = path.join(repoRoot, 'docs/public/deploy/production');
const readTemplate = (name: string) => fs.readFileSync(path.join(templateRoot, name), 'utf8');

describe('copy-ready production deployment templates', () => {
  it('replaces the obsolete root image launcher with one canonical template set', () => {
    for (const legacyFile of ['Dockerfile', 'docker-compose.yml', 'docker-entrypoint.sh']) {
      expect(fs.existsSync(path.join(repoRoot, legacyFile)), legacyFile).toBe(false);
    }
    const dockerGuide = fs.readFileSync(path.join(repoRoot, 'DOCKER.md'), 'utf8');
    expect(dockerGuide).toContain('does not currently publish an official container image');
    expect(dockerGuide).toContain('docs/public/deploy/production/');
    expect(dockerGuide).not.toContain('docker run -it');
  });

  it('runs a locally built image with durable state and a public health probe', () => {
    const compose = parse(readTemplate('docker-compose.yml')) as {
      services: Record<string, Record<string, unknown>>;
    };
    const service = compose.services.zhin as {
      build: { context: string; dockerfile: string };
      healthcheck: { test: string[] };
      env_file: string[];
      volumes: string[];
      ports: string[];
      read_only: boolean;
      init: boolean;
      cap_drop: string[];
      security_opt: string[];
    };

    expect(service.build).toEqual({ context: '.', dockerfile: 'Dockerfile' });
    expect(service.ports).toContain('127.0.0.1:8068:8068');
    expect(service.env_file).toEqual(['.env']);
    expect(service.healthcheck.test.join(' ')).toContain('/pub/health');
    expect(service.volumes).toEqual(expect.arrayContaining([
      'zhin-data:/app/data',
      'zhin-state:/app/.zhin',
    ]));
    expect(service.read_only).toBe(true);
    expect(service.init).toBe(true);
    expect(service.cap_drop).toContain('ALL');
    expect(service.security_opt).toContain('no-new-privileges:true');

    const dockerfile = readTemplate('Dockerfile');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('pnpm build');
    expect(dockerfile).not.toContain('pnpm prune --prod');
    expect(dockerfile).toContain('FROM node:24-bookworm-slim AS runtime');
    expect(dockerfile).toContain('mkdir -p /app/data /app/.zhin');
    expect(dockerfile).toContain('chown -R node:node /app/data /app/.zhin');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('CMD ["pnpm", "start"]');
  });

  it('supervises one foreground runtime with bounded restart and filesystem access', () => {
    const unit = readTemplate('zhin@.service');

    expect(unit).toContain('User=%i');
    expect(unit).toContain('WorkingDirectory=/srv/zhin/%i');
    expect(unit).toContain('ExecStart=/usr/bin/env pnpm start');
    expect(unit).toContain('EnvironmentFile=/srv/zhin/%i/.env');
    expect(unit).not.toContain('EnvironmentFile=-');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('StartLimitBurst=5');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).toContain('ReadWritePaths=/srv/zhin/%i/.zhin /srv/zhin/%i/data');
  });

  it('deploys the project config and all secrets in one non-root Kubernetes replica', () => {
    const resources = parseAllDocuments(readTemplate('kubernetes/resources.yaml'))
      .map((document) => document.toJSON() as Record<string, unknown>);
    const deployment = resources.find((resource) => resource.kind === 'Deployment');
    const service = resources.find((resource) => resource.kind === 'Service');
    const claim = resources.find((resource) => resource.kind === 'PersistentVolumeClaim');
    const config = resources.find((resource) => resource.kind === 'ConfigMap');
    expect(deployment).toBeDefined();
    expect(service).toBeDefined();
    expect(claim).toBeDefined();
    expect(config).toBeUndefined();

    const deploymentSpec = deployment!.spec as {
      replicas: number;
      template: {
        spec: {
          securityContext: { runAsNonRoot: boolean };
          containers: Array<{
            securityContext: Record<string, unknown>;
            readinessProbe: { httpGet: { path: string } };
            livenessProbe: { httpGet: { path: string } };
            volumeMounts: Array<{ name: string; mountPath: string }>;
            envFrom: Array<{ secretRef: { name: string } }>;
          }>;
        };
      };
    };
    const container = deploymentSpec.template.spec.containers[0];

    expect(deploymentSpec.replicas).toBe(1);
    expect(deploymentSpec.template.spec.securityContext.runAsNonRoot).toBe(true);
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
    });
    expect(container.readinessProbe.httpGet.path).toBe('/pub/health');
    expect(container.livenessProbe.httpGet.path).toBe('/pub/health');
    expect(container.envFrom).toEqual([{ secretRef: { name: 'zhin-secrets' } }]);
    expect(container.volumeMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'data', mountPath: '/app/data' }),
      expect.objectContaining({ name: 'state', mountPath: '/app/.zhin' }),
    ]));
    expect(container.volumeMounts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ mountPath: '/app/zhin.config.yml' }),
    ]));
    const serviceSpec = service!.spec as { ports: Array<{ port: number }> };
    const claimSpec = claim!.spec as { accessModes: string[] };
    expect(serviceSpec.ports[0].port).toBe(8068);
    expect(claimSpec.accessModes).toEqual(['ReadWriteOnce']);

    const envExample = readTemplate('env.example.txt');
    expect(envExample).toContain('HTTP_TOKEN=');
    expect(envExample).toContain('OPENAI_API_KEY=');
    for (const guide of ['docs/operations/production.md', 'docs/en/operations/production.md']) {
      const content = fs.readFileSync(path.join(repoRoot, guide), 'utf8');
      expect(content, guide).toContain('--from-env-file=.env');
    }
  });

  it('links every downloadable template from both production guides', () => {
    const expectedLinks = [
      '/deploy/production/Dockerfile',
      '/deploy/production/docker-compose.yml',
      '/deploy/production/dockerignore.txt',
      '/deploy/production/env.example.txt',
      '/deploy/production/zhin@.service',
      '/deploy/production/kubernetes/resources.yaml',
      '/deploy/production/kubernetes/kustomization.yaml',
    ];
    for (const guide of ['docs/operations/production.md', 'docs/en/operations/production.md']) {
      const content = fs.readFileSync(path.join(repoRoot, guide), 'utf8');
      for (const link of expectedLinks) expect(content, guide).toContain(`href="${link}"`);
    }
  });
});
