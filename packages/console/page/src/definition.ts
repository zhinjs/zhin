import {
  definePage as baseDefinePage,
  normalizeClientModuleArtifact,
  isConsoleBlueprint,
  normalizePageMetadata,
  pageRoute,
  assertPageLocalName,
  definePageBlueprint,
  createDeclarativePage,
  defineAdapterPage,
  createAdapterConsolePage,
  defineCommentReviewPage,
  createCommentReviewPage,
  buildBlueprintFromSpec,
  resolveDeclarativeText,
  projectBlueprintToImCard,
  projectBlueprintToCliPanel,
  optionalPageSection,
  CONSOLE_PAGE_SECTIONS,
  isConsolePageSection,
  type ConsolePageSection,
  type NormalizedPageMetadata,
  type PageManifest,
  type ClientModuleArtifact,
  type PageMetadata as BasePageMetadata,
  type DeclarativeI18nText,
  type DeclarativeBadgeTone,
  type DeclarativeButtonVariant,
  type DeclarativeUiLocale,
  type DeclarativeRenderable,
  type DeclarativePageContext,
  type DeclarativeBadgeSpec,
  type DeclarativeStatSpec,
  type DeclarativeActionFieldSpec,
  type DeclarativeActionSpec,
  type DeclarativeColumnSpec,
  type DeclarativeSectionSpec,
  type DeclarativePageSpec,
  type DeclarativePageComponentProps,
  type ConsolePageBlueprintSection,
  type ConsolePageBlueprint,
  type ConsoleAdapterPageBlueprint,
  type CommentReviewDraftBase,
  type CommentReviewEndpointBase,
  type CommentReviewBlueprintSpec,
  type BlueprintPageComponent,
  type AdapterPageComponent,
  type BlueprintProjectionOptions,
  type BlueprintImStatItem,
  type BlueprintImTableSection,
  type BlueprintImEntriesSection,
  type BlueprintImActionItem,
  type BlueprintImSegment,
  type BlueprintImCardProjection,
  type BlueprintCliPanelOptions,
} from '@zhin.js/console-contract';
import type { ValidationContext } from '@zhin.js/feature-kit';

export {
  CONSOLE_PAGE_SECTIONS,
  isConsolePageSection,
  normalizePageMetadata,
  normalizeClientModuleArtifact,
  isConsoleBlueprint,
  pageRoute,
  assertPageLocalName,
  definePageBlueprint,
  createDeclarativePage,
  defineAdapterPage,
  createAdapterConsolePage,
  defineCommentReviewPage,
  createCommentReviewPage,
  buildBlueprintFromSpec,
  resolveDeclarativeText,
  projectBlueprintToImCard,
  projectBlueprintToCliPanel,
  type ConsolePageSection,
  type NormalizedPageMetadata,
  type PageManifest,
  type ClientModuleArtifact,
  type DeclarativeI18nText,
  type DeclarativeBadgeTone,
  type DeclarativeButtonVariant,
  type DeclarativeUiLocale,
  type DeclarativeRenderable,
  type DeclarativePageContext,
  type DeclarativeBadgeSpec,
  type DeclarativeStatSpec,
  type DeclarativeActionFieldSpec,
  type DeclarativeActionSpec,
  type DeclarativeColumnSpec,
  type DeclarativeSectionSpec,
  type DeclarativePageSpec,
  type DeclarativePageComponentProps,
  type ConsolePageBlueprintSection,
  type ConsolePageBlueprint,
  type ConsoleAdapterPageBlueprint,
  type CommentReviewDraftBase,
  type CommentReviewEndpointBase,
  type CommentReviewBlueprintSpec,
  type BlueprintPageComponent,
  type AdapterPageComponent,
  type BlueprintProjectionOptions,
  type BlueprintImStatItem,
  type BlueprintImTableSection,
  type BlueprintImEntriesSection,
  type BlueprintImActionItem,
  type BlueprintImSegment,
  type BlueprintImCardProjection,
  type BlueprintCliPanelOptions,
};

export type PageTitleI18n = Readonly<Partial<Record<'zh-CN' | 'en', string>>>;

export interface PageComponentProps {
  pluginId?: string;
  owner?: string;
  localName?: string;
  route?: string;
  title?: string;
  [key: string]: unknown;
}

export interface PageMetadata extends BasePageMetadata {
  readonly description?: string;
  readonly group?: string;
  readonly parent?: string;
  readonly fullWidth?: boolean;
}

export type DefinedPage = Readonly<PageMetadata>;

export type PageExport<P = PageComponentProps> = (props: P) => unknown;

export function definePage(metadata: PageMetadata = {}): DefinedPage {
  const { description, group, parent, fullWidth, ...baseMeta } = metadata;
  if (description !== undefined && (typeof description !== 'string' || !description.trim())) {
    throw new TypeError('Page description must be a non-empty string');
  }
  if (group !== undefined && (typeof group !== 'string' || !group.trim())) {
    throw new TypeError('Page group must be a non-empty string');
  }
  if (parent !== undefined && (typeof parent !== 'string' || !parent.trim())) {
    throw new TypeError('Page parent must be a non-empty string');
  }
  if (fullWidth !== undefined && typeof fullWidth !== 'boolean') {
    throw new TypeError('Page fullWidth must be boolean');
  }
  const normalizedBase = baseDefinePage(baseMeta);
  return Object.freeze({
    ...normalizedBase,
    ...(description !== undefined ? { description } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(parent !== undefined ? { parent } : {}),
    ...(fullWidth !== undefined ? { fullWidth } : {}),
  });
}

export interface PageDefinition extends NormalizedPageMetadata {
  readonly description?: string;
  readonly group?: string;
  readonly parent?: string;
  readonly fullWidth?: boolean;
  readonly section?: ConsolePageSection;
  readonly module: string;
  readonly hash: string;
  readonly blueprint?: ConsolePageBlueprint | ConsoleAdapterPageBlueprint;
}

export function parsePageArtifact(value: unknown, context: ValidationContext): PageDefinition {
  const artifact = normalizeClientModuleArtifact(value, `Page ${context.source}`);
  const rawMeta = artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
    ? artifact.metadata as Record<string, unknown>
    : undefined;
  const { description, group, parent, fullWidth, section: rawSection, ...baseMeta } = rawMeta ?? {};
  const section = optionalPageSection(rawSection);
  if (description !== undefined && (typeof description !== 'string' || !description.trim())) {
    throw new TypeError('Page description must be a non-empty string');
  }
  if (group !== undefined && (typeof group !== 'string' || !group.trim())) {
    throw new TypeError('Page group must be a non-empty string');
  }
  if (parent !== undefined && (typeof parent !== 'string' || !parent.trim())) {
    throw new TypeError('Page parent must be a non-empty string');
  }
  if (fullWidth !== undefined && typeof fullWidth !== 'boolean') {
    throw new TypeError('Page fullWidth must be boolean');
  }
  return Object.freeze({
    ...normalizePageMetadata(context.localName, rawMeta === undefined ? undefined : baseMeta),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof group === 'string' ? { group } : {}),
    ...(typeof parent === 'string' ? { parent } : {}),
    ...(typeof fullWidth === 'boolean' ? { fullWidth } : {}),
    ...(section !== undefined ? { section } : {}),
    module: artifact.module,
    hash: artifact.hash,
    ...(artifact.blueprint !== undefined ? { blueprint: artifact.blueprint } : {}),
  });
}
