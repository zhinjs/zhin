import { describe, expect, it } from 'vitest';
import { CommandPathSyntaxError, bindCommandSource, defineCommand } from '../src/index.js';

const text = defineCommand({ params: { text: { type: 'string' } }, execute: ({ params }) => params.text });
const rest = defineCommand({
  params: { definition: { type: 'string', rest: true } },
  execute: ({ params }) => params.definition,
});

describe('bindCommandSource', () => {
  it('binds the directory parameter like the runtime loader', () => {
    const bound = bindCommandSource(text, '/p/commands/echo/[text]/index.ts');
    expect(bound.localName).toBe('echo/$text');
    expect(bound.definition.$parameter).toMatchObject({ name: 'text', optional: false, rest: false, type: 'string' });
  });

  it('accepts the command directory and static commands', () => {
    const plain = defineCommand({ execute: () => 'ok' });
    expect(bindCommandSource(plain, 'commands/netease/login').localName).toBe('netease/login');
    expect(bindCommandSource(plain, 'commands/netease/login').definition).toBe(plain);
  });

  it('rejects a dynamic segment that is not the last one', () => {
    expect(() => bindCommandSource(rest, '/p/commands/term/[word]/[...definition]/index.ts'))
      .toThrow(/the dynamic segment "\$word" must be the only dynamic segment and be the final path segment/);
  });

  it('rejects malformed directories and paths outside commands/', () => {
    expect(() => bindCommandSource(text, '/p/commands/echo/[text/index.ts')).toThrow(CommandPathSyntaxError);
    expect(() => bindCommandSource(text, '/p/commands/Echo/index.ts')).toThrow(/does not discover it/);
    expect(() => bindCommandSource(text, '/p/src/echo/index.ts')).toThrow(/expected a path under commands\//);
  });

  it('requires the params declaration the directory implies', () => {
    const plain = defineCommand({ execute: () => 'ok' });
    expect(() => bindCommandSource(plain, '/p/commands/echo/[text]/index.ts')).toThrow(/missing params\.text/);
    expect(() => bindCommandSource(text, '/p/commands/echo/[...text]/index.ts')).not.toThrow();
  });
});
