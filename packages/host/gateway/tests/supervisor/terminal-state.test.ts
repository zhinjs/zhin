import { describe, expect, it } from 'vitest';
import { captureTerminalState, isForegroundProcessGroup } from '../../src/supervisor/terminal-state.js';

describe('isForegroundProcessGroup', () => {
  // `pid (comm) state ppid pgrp session tty_nr tpgid …`
  const stat = (pgrp: number, tpgid: number) => `4242 (node (zhin) x) S 1 ${pgrp} ${pgrp} 34816 ${tpgid} 4194560 0 0`;

  it('compares the process group with the terminal foreground group (Linux /proc)', () => {
    expect(isForegroundProcessGroup({ platform: 'linux', pid: 4242, readStat: () => stat(4242, 4242) })).toBe(true);
    expect(isForegroundProcessGroup({ platform: 'linux', pid: 4242, readStat: () => stat(4242, 5000) })).toBe(false);
    // No controlling terminal (tpgid -1) or an unreadable probe: unknown counts as foreground.
    expect(isForegroundProcessGroup({ platform: 'linux', pid: 4242, readStat: () => stat(4242, -1) })).toBe(true);
    expect(isForegroundProcessGroup({ platform: 'linux', pid: 4242, readStat: () => { throw new Error('no /proc'); } })).toBe(true);
  });

  it('uses ps elsewhere on Unix and always allows Windows', () => {
    expect(isForegroundProcessGroup({ platform: 'darwin', pid: 1, ps: () => ' 77 77\n' })).toBe(true);
    expect(isForegroundProcessGroup({ platform: 'darwin', pid: 1, ps: () => ' 77 90\n' })).toBe(false);
    expect(isForegroundProcessGroup({ platform: 'win32' })).toBe(true);
  });

  it('runs against the real process', () => {
    expect(typeof isForegroundProcessGroup()).toBe('boolean');
  });
});

describe('captureTerminalState', () => {
  it('saves stty -g and restores exactly that state', () => {
    const calls: string[][] = [];
    const state = captureTerminalState({ platform: 'linux', stty: (args) => { calls.push([...args]); return args[0] === '-g' ? '500:5:bf:8a3b' : ''; } });
    state!.restore();
    expect(calls).toEqual([['-g'], ['500:5:bf:8a3b']]);
  });

  it('is a no-op on Windows and without stty', () => {
    expect(captureTerminalState({ platform: 'win32', stty: () => 'x' })).toBeUndefined();
    expect(captureTerminalState({ platform: 'linux', stty: () => undefined })).toBeUndefined();
  });
});
