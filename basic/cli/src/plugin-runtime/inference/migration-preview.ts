import {
  previewInferenceMigrationFromSources,
  readInferenceMigrationPreview,
  verifyInferenceMigrationPreviewFromSources,
  type InferenceMigrationMapping,
  type InferenceMigrationPreview,
  type InferenceMigrationResolution,
} from '@zhin.js/agent/runtime';
import {
  readLegacyInferenceSources,
  type LegacyInferenceReadOptions,
  type LegacyInferenceSources,
} from './migration-source.js';

export {
  readInferenceMigrationPreview,
  type InferenceMigrationMapping,
  type InferenceMigrationPreview,
  type InferenceMigrationResolution,
};

export async function previewInferenceMigration(
  options: LegacyInferenceReadOptions & Readonly<{ mapping?: InferenceMigrationMapping }>,
): Promise<InferenceMigrationPreview> {
  return previewInferenceMigrationFromSources(options, readLegacyInferenceSources);
}

export async function verifyInferenceMigrationPreview(
  preview: InferenceMigrationPreview,
): Promise<LegacyInferenceSources> {
  return verifyInferenceMigrationPreviewFromSources(preview, readLegacyInferenceSources);
}
