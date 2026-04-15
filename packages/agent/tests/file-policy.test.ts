import { describe, it, expect } from 'vitest';
import {
  checkFileAccess, assertFileAccess, checkBashCommandSafety, shellEscape,
  isBlockedDevicePath, classifyBashCommand, isFileStale,
  MAX_READ_FILE_SIZE, MAX_EDIT_FILE_SIZE,
} from '../src/file-policy.js';

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
        'data/memory/notes.md', // data 目录为敏感目录，禁止访问
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

  // ── isBlockedDevicePath（设备路径拦截）──

  describe('isBlockedDevicePath', () => {
    describe('应阻止危险设备路径', () => {
      const blocked = [
        '/dev/zero',
        '/dev/random',
        '/dev/urandom',
        '/dev/full',
        '/dev/stdin',
        '/dev/tty',
        '/dev/console',
        '/dev/stdout',
        '/dev/stderr',
        '/dev/fd/0',
        '/dev/fd/1',
        '/dev/fd/2',
      ];
      for (const p of blocked) {
        it(`阻止 ${p}`, () => {
          expect(isBlockedDevicePath(p)).toBe(true);
        });
      }
    });

    describe('应阻止 Linux /proc/ fd 别名', () => {
      it('阻止 /proc/self/fd/0', () => {
        expect(isBlockedDevicePath('/proc/self/fd/0')).toBe(true);
      });
      it('阻止 /proc/1234/fd/1', () => {
        expect(isBlockedDevicePath('/proc/1234/fd/1')).toBe(true);
      });
      it('阻止 /proc/self/fd/2', () => {
        expect(isBlockedDevicePath('/proc/self/fd/2')).toBe(true);
      });
    });

    describe('应允许安全设备路径', () => {
      it('允许 /dev/null', () => {
        expect(isBlockedDevicePath('/dev/null')).toBe(false);
      });
      it('允许普通文件', () => {
        expect(isBlockedDevicePath('/home/user/file.txt')).toBe(false);
      });
      it('允许 /proc/self/fd/3', () => {
        expect(isBlockedDevicePath('/proc/self/fd/3')).toBe(false);
      });
    });
  });

  // ── classifyBashCommand（命令读写分类）──

  describe('classifyBashCommand', () => {
    describe('只读搜索命令', () => {
      it('grep 是搜索', () => {
        const r = classifyBashCommand('grep -rn pattern src/');
        expect(r.isSearch).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });

      it('rg 是搜索', () => {
        const r = classifyBashCommand('rg "hello" .');
        expect(r.isSearch).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });

      it('find 是搜索', () => {
        const r = classifyBashCommand('find . -name "*.ts"');
        expect(r.isSearch).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });
    });

    describe('只读读取命令', () => {
      it('cat 是读取', () => {
        const r = classifyBashCommand('cat README.md');
        expect(r.isRead).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });

      it('head 是读取', () => {
        const r = classifyBashCommand('head -50 file.ts');
        expect(r.isRead).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });

      it('wc -l 是读取', () => {
        expect(classifyBashCommand('wc -l file.txt').isRead).toBe(true);
      });

      it('jq 是读取', () => {
        expect(classifyBashCommand('jq .name package.json').isRead).toBe(true);
      });
    });

    describe('只读列出命令', () => {
      it('ls 是列出', () => {
        const r = classifyBashCommand('ls -la');
        expect(r.isList).toBe(true);
        expect(r.isReadOnly).toBe(true);
      });

      it('tree 是列出', () => {
        expect(classifyBashCommand('tree .').isList).toBe(true);
      });
    });

    describe('管道组合', () => {
      it('cat | grep 是只读', () => {
        const r = classifyBashCommand('cat file.txt | grep pattern');
        expect(r.isReadOnly).toBe(true);
      });

      it('cat file && echo done 是只读（echo 是中性命令）', () => {
        const r = classifyBashCommand('cat file && echo done');
        expect(r.isReadOnly).toBe(true);
      });

      it('cat | sort | uniq 是只读', () => {
        expect(classifyBashCommand('cat file | sort | uniq').isReadOnly).toBe(true);
      });
    });

    describe('写/执行命令', () => {
      it('rm 不是只读', () => {
        expect(classifyBashCommand('rm file.txt').isReadOnly).toBe(false);
      });

      it('npm install 不是只读', () => {
        expect(classifyBashCommand('npm install').isReadOnly).toBe(false);
      });

      it('git push 不是只读', () => {
        expect(classifyBashCommand('git push').isReadOnly).toBe(false);
      });

      it('混合管道 cat | xargs rm 不是只读', () => {
        expect(classifyBashCommand('cat files.txt | xargs rm').isReadOnly).toBe(false);
      });
    });

    describe('纯中性命令', () => {
      it('echo "hello" 是只读', () => {
        expect(classifyBashCommand('echo "hello"').isReadOnly).toBe(true);
      });

      it(': (noop) 是只读', () => {
        expect(classifyBashCommand(':').isReadOnly).toBe(true);
      });
    });
  });

  // ── isFileStale ──

  describe('isFileStale', () => {
    it('相同 mtime 不是 stale', () => {
      expect(isFileStale(1000, 1000)).toBe(false);
    });

    it('1ms 误差内不是 stale', () => {
      expect(isFileStale(1000, 1000.5)).toBe(false);
    });

    it('超过 1ms 差异是 stale', () => {
      expect(isFileStale(1000, 1002)).toBe(true);
    });

    it('mtime 变小也是 stale', () => {
      expect(isFileStale(1000, 997)).toBe(true);
    });
  });

  // ── 常量导出 ──

  describe('常量', () => {
    it('MAX_READ_FILE_SIZE 为 256 MiB', () => {
      expect(MAX_READ_FILE_SIZE).toBe(256 * 1024 * 1024);
    });

    it('MAX_EDIT_FILE_SIZE 为 1 GiB', () => {
      expect(MAX_EDIT_FILE_SIZE).toBe(1024 * 1024 * 1024);
    });
  });
});
