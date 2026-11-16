import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { resolveStaticCapabilities, type AdapterCapabilityProfile } from '@zhin.js/adapter';
import sandboxAdapter from '../adapters/sandbox/index.js';

const adapterSource = (file: string) => new URL(`../../../../packages/im/adapter/src/${file}`, import.meta.url);

/** Property names of an exported interface, read from the declaration so a new field is seen at once. */
async function interfaceFields(file: string, name: string): Promise<string[]> {
  const path = adapterSource(file);
  const source = ts.createSourceFile(path.pathname, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === name);
  if (!declaration) throw new Error(`${name} not found in ${file}`);
  return declaration.members.flatMap((member) => member.name && ts.isIdentifier(member.name) ? [member.name.text] : []).sort();
}

const profile = sandboxAdapter.profile as AdapterCapabilityProfile;

/**
 * ADR 0064 §0.1 / §6: the Sandbox declares the highest level of every outbound capability. Each
 * field of the segment policy and of `messaging` is classified here; a new field fails this test
 * until it is classified, so the Sandbox declaration is updated together with the profile.
 */
const SEGMENT_POLICY_CEILING: Record<string, (value: unknown) => boolean | string> = {
  // Not declared = no allow-list: every segment type passes through.
  supported: (value) => value === undefined,
  html: (value) => value === 'direct',
  markdown: (value) => value === 'native',
  interactive: (value) => value === 'native',
  // `upload` is a platform upload channel; the Sandbox renders inline base64 and reads paths itself.
  outboundMedia: (value) => Array.isArray(value) && ['url', 'base64', 'path'].every((form) => value.includes(form)),
  // Prompt hints for platform-specific fields: not a capability level.
  model: () => true,
  // Agent reactions on the message it answers: deliberately not declared yet (follow-up; changes Agent replies).
  reaction: () => 'not applicable',
};

const MESSAGING_CEILING: Record<string, (value: unknown) => boolean | string> = {
  segments: () => true,
  // Not declared = unlimited.
  maxLength: (value) => value === undefined,
  maxMessagesPerTurn: (value) => value === undefined,
  mention: (value) => JSON.stringify(value) === JSON.stringify({ user: true, all: true }),
  quote: (value) => value === true,
  streaming: (value) => JSON.stringify(value) === JSON.stringify({ mode: 'native', formats: ['text', 'markdown'] }),
  recall: (value) => JSON.stringify(value) === JSON.stringify({ others: true }),
  edit: (value) => value === true,
  reaction: (value) => JSON.stringify(value) === JSON.stringify({}),
  // Forward segments render in the page; the platform `forward` action (relaying a message) is not simulated.
  forward: () => 'not applicable',
};

describe('Sandbox profile is the capability ceiling (ADR 0064 §0.1)', () => {
  it('classifies every segment policy field', async () => {
    expect(await interfaceFields('definition.ts', 'AdapterSegmentPolicy')).toEqual(Object.keys(SEGMENT_POLICY_CEILING).sort());
    const segments = (profile.default?.messaging?.segments ?? {}) as Record<string, unknown>;
    for (const [field, check] of Object.entries(SEGMENT_POLICY_CEILING)) {
      expect(check(segments[field]), `messaging.segments.${field}`).toBeTruthy();
    }
  });

  it('classifies every messaging field and declares the ceiling in every conversation kind', async () => {
    expect(await interfaceFields('capability-profile.ts', 'MessagingCapabilities')).toEqual(Object.keys(MESSAGING_CEILING).sort());
    for (const kind of ['private', 'group', 'channel']) {
      const messaging = (resolveStaticCapabilities(profile, [kind]).messaging ?? {}) as Record<string, unknown>;
      for (const [field, check] of Object.entries(MESSAGING_CEILING)) {
        expect(check(messaging[field]), `${kind}: messaging.${field}`).toBeTruthy();
      }
    }
  });

  it('declares the message actions it implements', () => {
    const actions = resolveStaticCapabilities(profile, ['group']).actions ?? {};
    expect(Object.keys(actions).sort()).toEqual(['quoteReply', 'reaction', 'recall']);
  });
});
