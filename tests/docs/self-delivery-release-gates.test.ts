import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = (name: string) => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

describe('formal release isolation from self delivery', () => {
  it('requires the npm production environment before any publishing credentials are available', () => {
    const config = workflow('publish');
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(config.env).not.toHaveProperty('NPM_TOKEN');
    expect(config.jobs.publish.environment).toBe('npm-production');
    expect(config.jobs.publish.if).toBe("github.repository == 'zhinjs/zhin' && github.ref == 'refs/heads/main'");
    expect(config.jobs.publish.permissions['id-token']).toBe('write');
  });

  it('limits Pages deployment rights to the separately gated main deployment job', () => {
    const config = workflow('deploy-docs');
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(config.jobs.build.permissions ?? config.permissions).not.toHaveProperty('pages');
    expect(config.jobs.deploy.environment.name).toBe('github-pages');
    expect(config.jobs.deploy.needs).toBe('build');
    for (const job of [config.jobs.build, config.jobs.deploy]) {
      expect(job.if).toBe("github.repository == 'zhinjs/zhin' && github.ref == 'refs/heads/main'");
    }
    expect(config.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
  });
});
