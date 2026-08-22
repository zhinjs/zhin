import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Workroom shared Pack publisher authority gate', () => {
  it('never upgrades an HTTP principal to control-plane Root', async () => {
    const source = await readFile(new URL(
      '../../basic/cli/src/plugin-runtime/agent-host-installer.ts',
      import.meta.url,
    ), 'utf8');
    expect(source).not.toMatch(
      /publishPack[\s\S]{0,900}authenticatedPrincipalId:\s*WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL/u,
    );
    expect(source).toContain('authenticatedPrincipalId: authenticatedPrincipal.principalId');
    expect(source).toContain('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
    expect(source).toContain('trustedPackPublishers: options.workroomTrustedPackPublishers ?? []');
  });
});
