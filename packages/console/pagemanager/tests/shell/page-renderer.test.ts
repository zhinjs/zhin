import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_SHELL_CDN_VERSIONS, renderPageShell } from '../../src/shell/page-renderer.js';

const repoFile = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
}

describe('page shell importmap', () => {
  const html = renderPageShell({
    id: 'page', route: '/p-status', title: 'Status', module: '/assets/status.js',
  } as never);
  const importMap = JSON.parse(
    /<script type="importmap">([\s\S]*?)<\/script>/u.exec(html)![1]!,
  ) as { imports: Record<string, string> };

  it('pins every CDN module from the single version constant', () => {
    const { react, reactRouter } = PAGE_SHELL_CDN_VERSIONS;
    expect(importMap.imports).toEqual({
      react: `https://esm.sh/react@${react}`,
      'react/jsx-runtime': `https://esm.sh/react@${react}/jsx-runtime`,
      'react/jsx-dev-runtime': `https://esm.sh/react@${react}/jsx-dev-runtime`,
      'react-dom': `https://esm.sh/react-dom@${react}`,
      'react-dom/client': `https://esm.sh/react-dom@${react}/client`,
      'react-router': `https://esm.sh/react-router@${reactRouter}?deps=react@${react},react-dom@${react}`,
      'react-router-dom': `https://esm.sh/react-router-dom@${reactRouter}?deps=react@${react},react-dom@${react}`,
    });
  });

  it('does not let the CDN undercut the workspace security floor for react-router', () => {
    const floor = /react-router@[^:]*:\s*'>=(\d+\.\d+\.\d+)'/u.exec(repoFile('pnpm-workspace.yaml'))?.[1];
    expect(floor).toBeDefined();
    expect(compareVersions(PAGE_SHELL_CDN_VERSIONS.reactRouter, floor!)).toBeGreaterThanOrEqual(0);
  });

  it('serves a React inside the range the Console client is built against', () => {
    const range = (JSON.parse(repoFile('packages/console/client/package.json')) as {
      devDependencies: Record<string, string>;
    }).devDependencies.react!;
    const minimum = /^\^(\d+\.\d+\.\d+)$/u.exec(range)?.[1];
    expect(minimum).toBeDefined();
    expect(PAGE_SHELL_CDN_VERSIONS.react.split('.')[0]).toBe(minimum!.split('.')[0]);
    expect(compareVersions(PAGE_SHELL_CDN_VERSIONS.react, minimum!)).toBeGreaterThanOrEqual(0);
  });
});
