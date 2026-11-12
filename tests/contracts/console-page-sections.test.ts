import { describe, expect, it } from 'vitest';
import { CONSOLE_PAGE_SECTIONS as AUTHORING } from '../../packages/console/plugin-contract/src/page.js';
import { CONSOLE_PAGE_SECTIONS as WIRE } from '../../packages/console/protocol/src/navigation.js';

describe('Console page sections (ADR 0052)', () => {
  it('keeps the dependency-free authoring list equal to the wire vocabulary', () => {
    expect([...AUTHORING]).toEqual([...WIRE]);
  });
});
