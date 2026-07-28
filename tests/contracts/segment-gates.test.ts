import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GATES = {
  segments: 'scripts/check-segment-adapters.mjs',
  rich: 'scripts/check-rich-segment-adapters.mjs',
  interactive: 'scripts/check-interactive-segment-adapters.mjs',
  aiOutbound: 'scripts/check-ai-outbound-adapters.mjs',
} as const;

interface Fixture {
  readonly root: string;
  readonly cleanup: () => void;
}

/** 构造 plugins/adapters 形态的 fixture 根目录。 */
function makeFixture(adapters: Record<string, {
  readonly entry?: string;
  readonly tests?: Record<string, string>;
}>): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-gates-'));
  for (const [name, spec] of Object.entries(adapters)) {
    if (spec.entry !== undefined) {
      const dir = path.join(root, name, 'adapters');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.ts`), spec.entry);
    } else {
      fs.mkdirSync(path.join(root, name), { recursive: true });
    }
    for (const [file, content] of Object.entries(spec.tests ?? {})) {
      const dir = path.join(root, name, 'tests');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function runGate(gate: keyof typeof GATES, adaptersRoot: string) {
  return spawnSync(process.execPath, [path.join(repoRoot, GATES[gate]), adaptersRoot], {
    encoding: 'utf8',
  });
}

const DECLARED_ENTRY = `import { defineAdapter } from '@zhin.js/adapter';
export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  segments: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  create: () => ({}),
});
`;

const UNDECLARED_ENTRY = `import { defineAdapter } from '@zhin.js/adapter';
export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create: () => ({}),
});
`;

describe('segment gate scripts（adapters/*.ts 探测点）', () => {
  it('已声明 segments 的 adapter 通过三道段门禁', () => {
    const fixture = makeFixture({
      declared: { entry: DECLARED_ENTRY },
      // 无 adapters/ 目录的包不参与校验
      'not-an-adapter': {},
    });
    try {
      for (const gate of ['segments', 'rich', 'interactive'] as const) {
        const result = runGate(gate, fixture.root);
        expect(result.status, `${gate}: ${result.stderr}`).toBe(0);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('未声明且不在豁免名单的 adapter 三道门禁均报错', () => {
    const fixture = makeFixture({ fakebot: { entry: UNDECLARED_ENTRY } });
    try {
      const segments = runGate('segments', fixture.root);
      expect(segments.status).toBe(1);
      expect(segments.stderr).toContain('fakebot');
      expect(segments.stderr).toContain('segments');

      const rich = runGate('rich', fixture.root);
      expect(rich.status).toBe(1);
      expect(rich.stderr).toContain('fakebot');
      expect(rich.stderr).toContain('outboundMedia');

      const interactive = runGate('interactive', fixture.root);
      expect(interactive.status).toBe(1);
      expect(interactive.stderr).toContain('fakebot');
      expect(interactive.stderr).toContain('interactive');
    } finally {
      fixture.cleanup();
    }
  });

  it('只声明部分子字段时：对应门禁通过，其余门禁仍报错', () => {
    const fixture = makeFixture({
      partial: {
        entry: UNDECLARED_ENTRY.replace(
          'capabilities: [',
          'segments: { outboundMedia: [\'url\'] },\n  capabilities: [',
        ),
      },
    });
    try {
      expect(runGate('segments', fixture.root).status).toBe(0);
      expect(runGate('rich', fixture.root).status).toBe(0);
      const interactive = runGate('interactive', fixture.root);
      expect(interactive.status).toBe(1);
      expect(interactive.stderr).toContain('partial');
    } finally {
      fixture.cleanup();
    }
  });

  it('三道门禁的 PENDING 豁免名单已收敛为空（Wave 2 完成）', () => {
    // Wave 2 全量声明后豁免清零；新增 adapter 未迁移时才允许重新加入名单。
    for (const gate of ['segments', 'rich', 'interactive'] as const) {
      const source = fs.readFileSync(path.join(repoRoot, GATES[gate]), 'utf8');
      const setBody = source.match(/PENDING = new Set\(\[([\s\S]*?)\]\)/u)?.[1] ?? '';
      const names = [...setBody.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
      expect(names, `${gate} PENDING 应为空`).toEqual([]);
    }
  });

  it('check:ai-outbound 只在声明 aiOutboundExtensions 时要求配套', () => {
    const fixture = makeFixture({
      plain: { entry: UNDECLARED_ENTRY },
      aio: {
        entry: UNDECLARED_ENTRY.replace(
          'create:',
          'aiOutboundExtensions: true,\n  aiOutboundCapabilities: true,\n  create:',
        ),
      },
    });
    try {
      // 声明了 extensions + capabilities 但缺契约测试 → 失败
      const missing = runGate('aiOutbound', fixture.root);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('aio');
      expect(missing.stderr).toContain('ai-outbound-contract');

      // 补上契约测试 → 通过
      fs.mkdirSync(path.join(fixture.root, 'aio', 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(fixture.root, 'aio', 'tests', 'ai-outbound-contract.test.ts'),
        '// contract',
      );
      const ok = runGate('aiOutbound', fixture.root);
      expect(ok.status, ok.stderr).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });
});
