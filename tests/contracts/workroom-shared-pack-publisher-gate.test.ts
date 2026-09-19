import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Workroom shared Pack publisher authority gate', () => {
  it('never upgrades an HTTP principal to control-plane Root', async () => {
    const [installer, profileCoordinator] = await Promise.all([
      readFile(new URL(
        '../../basic/cli/src/plugin-runtime/agent-host-installer.ts',
        import.meta.url,
      ), 'utf8'),
      readFile(new URL(
        '../../basic/cli/src/plugin-runtime/workroom-profile-coordinator.ts',
        import.meta.url,
      ), 'utf8'),
    ]);
    expect(installer).not.toMatch(
      /publishPack[\s\S]{0,900}authenticatedPrincipalId:\s*WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL/u,
    );
    expect(installer).toContain('authenticatedPrincipalId: authenticatedPrincipal.principalId');
    expect(installer).toContain('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
    expect(installer).toContain('trustedPackPublishers: options.workroomTrustedPackPublishers,');
    expect(profileCoordinator).toContain(
      'trustedPackPublishers: options.trustedPackPublishers ?? []',
    );
  });
});
