import { describe, it, expect } from 'vitest';
import { checkFileAccess, assertFileAccess, checkBashCommandSafety, shellEscape } from '../src/file-policy.js';

describe('file-policy', () => {
  // ── checkFileAccess ──

  describe('checkFileAccess', () => {
    describe('应阻止敏感文件', () => {
      const blocked = [
        '.env',
        '.env.local',
        '.env.production',
        '.env.development.local',
        'id_rsa',
        'id_ed25519',
        'server.pem',
        'private.key',
        'cert.p12',
        'keystore.pfx',
        'store.jks',
        'app.keystore',
        '.npmrc',
        '.pypirc',
        '.netrc',
        'credentials',
        'credentials.json',
        'service_account.json',
        'service-account-key.json',
        'token.json',
        '.pgpass',
        '.my.cnf',
        '.passwd',
        '.bash_history',
        '.zsh_history',
        '.node_repl_history',
        '.python_history',
      ];

      for (const name of blocked) {
        it(`阻止 ${name}`, () => {
          const result = checkFileAccess(`/home/user/${name}`);
          expect(result.allowed).toBe(false);
          expect(result.reason).toBeTruthy();
        });
      }
    });

    describe('应阻止敏感目录', () => {
      const blockedPaths = [
        '/home/user/.ssh/id_rsa.pub',
        '/home/user/.gnupg/secring.gpg',
        '/home/user/.aws/credentials',
        '/home/user/.azure/config',
        '/home/user/.gcloud/properties',
        '/home/user/.kube/config',
        '/root/.ssh/authorized_keys',
      ];

      for (const p of blockedPaths) {
        it(`阻止 ${p}`, () => {
          const result = checkFileAccess(p);
          expect(result.allowed).toBe(false);
        });
      }
    });

    describe('应阻止系统敏感路径', () => {
      it('阻止 /etc/shadow', () => {
        expect(checkFileAccess('/etc/shadow').allowed).toBe(false);
      });

      it('阻止 /etc/gshadow', () => {
        expect(checkFileAccess('/etc/gshadow').allowed).toBe(false);
      });

      it('阻止 /etc/ssl/private/key.pem', () => {
        expect(checkFileAccess('/etc/ssl/private/key.pem').allowed).toBe(false);
      });
    });

    describe('应允许正常文件', () => {
      const allowed = [
        '/home/user/project/src/index.ts',
        '/home/user/project/package.json',
        '/home/user/project/README.md',
        '/home/user/project/tsconfig.json',
        './src/utils.ts',
        'data/memory/notes.md',
        '/tmp/test.txt',
      ];

      for (const p of allowed) {
        it(`允许 ${p}`, () => {
          expect(checkFileAccess(p).allowed).toBe(true);
        });
      }
    });
  });

  // ── assertFileAccess ──

  describe('assertFileAccess', () => {
    it('对敏感文件抛出错误', () => {
      expect(() => assertFileAccess('/home/user/.env')).toThrow('敏感文件');
    });

    it('对正常文件不抛出', () => {
      expect(() => assertFileAccess('/home/user/src/index.ts')).not.toThrow();
    });
  });

  // ── checkBashCommandSafety ──

  describe('checkBashCommandSafety', () => {
    describe('应阻止环境变量泄漏命令', () => {
      const blocked = [
        'env',
        'printenv',
        'export',
        'set',
        'env | grep SECRET',
        'printenv TOKEN',
        '  env  ',
      ];

      for (const cmd of blocked) {
        it(`阻止: ${cmd}`, () => {
          const result = checkBashCommandSafety(cmd);
          expect(result.safe).toBe(false);
          expect(result.reason).toContain('环境变量');
        });
      }
    });

    describe('应阻止 echo 敏感环境变量', () => {
      const blocked = [
        'echo $SECRET_KEY',
        'echo ${API_KEY}',
        'echo $TOKEN',
        'echo $PASSWORD',
        'printf "%s" $AUTH_TOKEN',
        'echo $MY_CREDENTIAL',
      ];

      for (const cmd of blocked) {
        it(`阻止: ${cmd}`, () => {
          expect(checkBashCommandSafety(cmd).safe).toBe(false);
        });
      }
    });

    describe('应阻止 cat 敏感文件', () => {
      const blocked = [
        'cat .env',
        'cat /path/to/.env.local',
        'cat server.pem',
        'cat private.key',
        'cat cert.p12',
      ];

      for (const cmd of blocked) {
        it(`阻止: ${cmd}`, () => {
          expect(checkBashCommandSafety(cmd).safe).toBe(false);
        });
      }
    });

    describe('应允许安全命令', () => {
      const safe = [
        'ls -la',
        'cat README.md',
        'node --version',
        'pnpm install',
        'git status',
        'tsc --build',
        'echo "hello world"',
        'grep -rn "function" src/',
      ];

      for (const cmd of safe) {
        it(`允许: ${cmd}`, () => {
          expect(checkBashCommandSafety(cmd).safe).toBe(true);
        });
      }
    });
  });

  // ── shellEscape ──

  describe('shellEscape', () => {
    it('普通字符串加引号', () => {
      expect(shellEscape('hello')).toBe("'hello'");
    });

    it('转义单引号', () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'");
    });

    it('空字符串', () => {
      expect(shellEscape('')).toBe("''");
    });

    it('含特殊字符', () => {
      const escaped = shellEscape('$(rm -rf /)');
      expect(escaped).toBe("'$(rm -rf /)'");
      // 被单引号包裹后 shell 不会执行内部的命令替换
    });

    it('含分号', () => {
      expect(shellEscape('foo; rm -rf /')).toBe("'foo; rm -rf /'");
    });

    it('含反引号', () => {
      expect(shellEscape('`whoami`')).toBe("'`whoami`'");
    });
  });
});
