import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHostProtectedPaths, toProtectedPathData } from '../../src/security/host-config-paths.js';
import { computeReadOnlyOverlays } from '../../src/security/sandbox-mounts.js';
import { executeInDocker, isDockerAvailable } from '../../src/security/sandbox-docker.js';

/** Opt-in: needs a running Docker daemon and an image (`ZHIN_DOCKER_TEST_IMAGE`, default node:20-alpine). */
const enabled = process.env.ZHIN_DOCKER_TESTS === '1' && isDockerAvailable();
const image = process.env.ZHIN_DOCKER_TEST_IMAGE ?? 'node:20-alpine';

describe.skipIf(!enabled)('isolated shell read-only mounts (docker)', () => {
  let ws: string;
  beforeAll(() => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-ro-docker-')));
    fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'rules\n');
    fs.writeFileSync(path.join(ws, 'package.json'), '{}\n');
    fs.mkdirSync(path.join(ws, 'node_modules/x'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'node_modules/x/i.js'), '1\n');
    fs.mkdirSync(path.join(ws, 'sub/node_modules'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'sub/node_modules/i.js'), '1\n');
  });
  afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

  const run = async (command: string) => {
    const paths = await createHostProtectedPaths({ projectRoot: ws });
    return executeInDocker(command, {
      workingDirectory: ws,
      filesystemAccess: 'workspace-write',
      dockerImage: image,
      timeout: 120_000,
      readOnlyOverlays: computeReadOnlyOverlays(ws, toProtectedPathData(paths)),
    });
  };

  it.each([
    ['redirect into AGENTS.md', 'echo x > AGENTS.md'],
    ['sed -i on AGENTS.md', "sed -i 's/rules/evil/' AGENTS.md"],
    ['write through a symlink', 'ln -s AGENTS.md l && echo x > l'],
    ['rm -rf node_modules', 'rm -rf node_modules'],
    ['rm -rf nested node_modules', 'rm -rf sub/node_modules'],
    ['mv package.json', 'mv package.json p'],
    ['create skills/', 'mkdir skills/x'],
  ])('refuses: %s', async (_name, command) => {
    const result = await run(command);
    expect(result.exitCode).not.toBe(0);
    expect(fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8')).toBe('rules\n');
    expect(fs.existsSync(path.join(ws, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'node_modules/x/i.js'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'sub/node_modules/i.js'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'p'))).toBe(false);
    expect(fs.existsSync(path.join(ws, 'skills/x'))).toBe(false);
  }, 180_000);

  it('still writes ordinary files and leaves no mount-point leftovers', async () => {
    const result = await run('echo hi > ok.txt && mkdir -p src && echo 1 > src/a.ts');
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(ws, 'ok.txt'), 'utf8')).toBe('hi\n');
    expect(fs.existsSync(path.join(ws, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.agents'))).toBe(false);
  }, 180_000);
});
