export * from '@zhin.js/agent/runtime';
import {
  applySessionBindingsWithSources,
  previewSessionBindingsFromSources,
  type ApplySessionBindingsOptions,
  type PreviewSessionBindingsOptions,
  type SessionBindingsPreview,
  type SessionBindingsRunView,
} from '@zhin.js/agent/runtime';
import { assertStopped, withProjectLock } from '../migrate/instance-declarations.js';
import * as headless from '@zhin.js/agent/runtime';
import * as journals from '@zhin.js/agent/runtime';
import { readLegacyInferenceSources } from './migration-source.js';

export async function previewSessionBindings(
  options: PreviewSessionBindingsOptions,
): Promise<SessionBindingsPreview> {
  return previewSessionBindingsFromSources(options, readLegacyInferenceSources);
}

export async function applySessionBindings(
  options: ApplySessionBindingsOptions,
): Promise<SessionBindingsRunView> {
  return applySessionBindingsWithSources(options, {
    readLegacySources: readLegacyInferenceSources,
    assertStopped,
    withProjectLock,
    openHeadlessInferenceHost: (input) => headless.openHeadlessInferenceHost(input),
    applyMigrationSessionJournal: (input) => journals.applyMigrationSessionJournal(input),
  });
}
