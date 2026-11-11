import { describe, it, expect } from 'vitest';
import {
  checkTurnExecPolicy,
  checkUnattendedExecPreset,
  findUnsafeShellSyntax,
  splitCompoundCommand,
} from '../../src/security/exec-policy.js';
import { classifyBashCommand, extractBashReadPaths } from '../../src/security/file-policy.js';

/** Commands that write files or execute other programs: must never pass the readonly preset. */
const BYPASSES: Array<[label: string, command: string]> = [
  ['awk system()', `awk 'BEGIN{system("rm -rf /tmp/x")}'`],
  ['gawk', `gawk '{print > "/tmp/out"}' file`],
  ['find -delete', 'find . -name "*.log" -delete'],
  ['find -exec', 'find . -exec rm {} ;'],
  ['find -execdir', 'find . -execdir sh -c "id" ;'],
  ['find -ok', 'find . -ok rm {} ;'],
  ['find -fprint', 'find . -fprint /tmp/out'],
  ['find -fprintf', 'find . -fprintf /tmp/out %p'],
  ['find -fls', 'find . -fls /tmp/out'],
  ['find behind a wrapper', 'timeout 5 find . -delete'],
  ['sed -i', "sed -i 's/a/b/' file"],
  ['sed --in-place', "sed --in-place=.bak 's/a/b/' file"],
  ['sed -ni cluster', "sed -ni 's/a/b/p' file"],
  ['sed w command', "sed -n 'w /tmp/out' file"],
  ['sed s///w flag', "sed 's/a/b/w /tmp/out' file"],
  ['sed s///w flag without space', "sed 's/a/b/w/tmp/out' file"],
  ['sed e command', "sed '1e id' file"],
  ['sed s///e flag', "sed 's/a/id/e' file"],
  ['sed -f script', 'sed -f script.sed file'],
  ['output redirection', 'echo x > file'],
  ['append redirection', 'echo x >> file'],
  ['redirection without space', 'cat a>b'],
  ['&> redirection', 'ls &> out.txt'],
  ['>| redirection', 'cat a >| b'],
  ['>& file redirection', 'ls >& out.txt'],
  ['stderr redirection to a file', 'grep x file 2> errors.log'],
  ['background &', 'ls & rm -rf x'],
  ['trailing background &', 'rm -rf x &'],
  ['process substitution <()', 'cat <(rm -rf x)'],
  ['process substitution >()', 'cat file > >(tee out)'],
  ['command substitution', 'cat $(rm -rf x)'],
  ['backticks', 'cat `rm -rf x`'],
  ['sort -o', 'sort -o out.txt in.txt'],
  ['sort --output', 'sort --output=out.txt in.txt'],
  ['sort -uo cluster', 'sort -uo out.txt in.txt'],
  ['tee', 'cat a | tee b'],
  ['xargs', 'cat files.txt | xargs rm'],
  ['uniq with output operand', 'uniq in.txt out.txt'],
  ['PATH override', 'PATH=/tmp/evil ls'],
  ['LD_PRELOAD override', 'LD_PRELOAD=/tmp/x.so cat file'],
  ['relative binary named like a read command', './ls -la'],
];

/** Read-only commands whose quoted arguments merely look like shell operators. */
const BENIGN: Array<[label: string, command: string]> = [
  ['quoted >', "grep '>' file"],
  ['double-quoted >', 'grep "a > b" file'],
  ['quoted &', 'echo "a & b"'],
  ['quoted process-substitution lookalike', 'grep "<(x)" file'],
  ['escaped >', 'grep \\> file'],
  ['plain find', 'find . -name "*.ts" -type f'],
  ['find with a quoted -delete pattern operand', 'grep -- "-delete" file'],
  ['sed print range', "sed -n '1,20p' file"],
  ['sed substitution to stdout', "sed 's/a/b/g' file"],
  ['sed -e expression', "sed -n -e '/foo/p' file"],
  ['sort to stdout', 'sort -u in.txt'],
  ['pipeline', 'cat file | grep pattern | sort | uniq'],
  ['stderr to /dev/null', 'grep -r x . 2>/dev/null'],
  ['stderr to stdout', 'ls -la 2>&1'],
  ['&> /dev/null', 'ls &>/dev/null'],
  ['locale prefix', 'LC_ALL=C grep x file'],
  ['compound read', 'ls -la && cat README.md'],
  ['input redirection', 'wc -l < file'],
];

describe('readonly exec preset — soundness', () => {
  it.each(BYPASSES)('rejects %s: %s', (_label, command) => {
    expect(classifyBashCommand(command).isReadOnly).toBe(false);
    expect(checkUnattendedExecPreset(command, 'readonly').allowed).toBe(false);
    expect(
      checkTurnExecPolicy(command, { security: 'allowlist', execPreset: 'readonly', approvalMode: 'auto' }).allowed,
    ).toBe(false);
  });

  it.each(BENIGN)('allows %s: %s', (_label, command) => {
    expect(checkUnattendedExecPreset(command, 'readonly')).toEqual({ allowed: true });
    expect(
      checkTurnExecPolicy(command, { security: 'allowlist', execPreset: 'readonly', approvalMode: 'auto' }),
    ).toEqual({ allowed: true });
  });

  it.each(BENIGN.filter(([label]) => label !== 'locale prefix'))('classifies %s as read-only', (_label, command) => {
    expect(classifyBashCommand(command).isReadOnly).toBe(true);
  });

  it('keeps the non-classified readonly preset commands usable without side effects', () => {
    expect(checkUnattendedExecPreset('pwd', 'readonly').allowed).toBe(true);
    expect(checkUnattendedExecPreset('date > /tmp/now', 'readonly').allowed).toBe(false);
  });
});

describe('shell syntax helpers', () => {
  it('treats a single & as a command separator but not && or redirections', () => {
    expect(splitCompoundCommand('ls & rm x')).toEqual(['ls', 'rm x']);
    expect(splitCompoundCommand('ls && rm x')).toEqual(['ls', 'rm x']);
    expect(splitCompoundCommand('ls 2>&1')).toEqual(['ls 2>&1']);
    expect(splitCompoundCommand('ls &>/dev/null')).toEqual(['ls &>/dev/null']);
    expect(splitCompoundCommand('echo "a & b"')).toEqual(['echo "a & b"']);
  });

  it('rejects process substitution outside quotes only', () => {
    expect(findUnsafeShellSyntax('cat <(ls)')).toBeDefined();
    expect(findUnsafeShellSyntax('tee >(cat)')).toBeDefined();
    expect(findUnsafeShellSyntax('grep "<(x)" file')).toBeUndefined();
    expect(findUnsafeShellSyntax("grep '>(x)' file")).toBeUndefined();
  });

  it('still inspects awk file operands and quoted pipes for sensitive paths', () => {
    expect(extractBashReadPaths("awk '{print}' .env")).toContain('.env');
    expect(extractBashReadPaths("grep 'a|b' .env")).toContain('.env');
  });
});
