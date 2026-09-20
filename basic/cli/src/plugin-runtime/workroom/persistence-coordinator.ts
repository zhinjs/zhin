import { join } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  ActivatableAssignmentAuthorityGrantRepository,
  ActivatableOverlayPackPromotionRepository,
  ActivatablePortfolioControlOutboxRepository,
  ActivatableProjectKnowledgeJournal,
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
  DatabaseAssignmentAuthorityGrantRepository,
  DatabaseOverlayPackPromotionRepository,
  DatabasePortfolioControlOutboxRepository,
  DatabaseProjectKnowledgeJournal,
  FileAssignmentAuthorityGrantRepository,
  FileOverlayPackPromotionRepository,
  FilePortfolioControlOutboxRepository,
  FileProjectKnowledgeJournal,
  FileWorkroomCatalog,
  FileWorkroomJournal,
  type AIService,
} from '@zhin.js/agent';
import {
  activateAiDatabaseStorage,
  createGenerationOwnedWorkroomDataGovernanceStorage,
  defineAiDatabaseModels,
  portfolioJournalRepositoryToken,
  type SemanticMemoryRuntime,
  type ZhinAgent,
} from '@zhin.js/agent/runtime';
import { databaseRootHostToken, type DatabaseHost } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import {
  assertFixedWorkroomStorageMode,
  resolveWorkroomStorageMode,
  type AgentHostAIConfig,
  type WorkroomStorageMode,
} from '../agent/config.js';
import { assertWorkroomCatalogMatchesGeneration } from './projection.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];
type WorkroomJournalPayloadPort = Parameters<typeof activateAiDatabaseStorage>[4];
type DataGovernanceStorage = ReturnType<typeof createGenerationOwnedWorkroomDataGovernanceStorage>;

export interface WorkroomPersistenceCoordinatorOptions {
  readonly projectRoot: string;
  readonly config: AgentHostAIConfig;
  readonly fixedStorageMode: WorkroomStorageMode;
  readonly resources: RootResourceContext['resources'];
  readonly handoff: RootResourceContext['handoff'];
  readonly service: AIService;
  readonly agent: ZhinAgent;
  readonly semanticMemory: SemanticMemoryRuntime | null;
  readonly journal: ActivatableWorkroomJournal;
  readonly journalPayloads: WorkroomJournalPayloadPort;
  readonly catalog: ActivatableWorkroomCatalog;
  readonly listAgentNames: () => readonly string[];
  readonly resolveConfiguredEndpointKeys?: () => Promise<ReadonlySet<string>>;
  readonly recoverHumanIngress: () => Promise<void>;
}

/** Owns Workroom persistence selection, activation, migration, and readiness. */
export class WorkroomPersistenceCoordinator {
  readonly stateRoot: string;
  readonly assignmentAuthorityGrants = new ActivatableAssignmentAuthorityGrantRepository();
  readonly projectKnowledgeJournal = new ActivatableProjectKnowledgeJournal();
  readonly overlayPackPromotions = new ActivatableOverlayPackPromotionRepository();
  readonly portfolioControlOutbox = new ActivatablePortfolioControlOutboxRepository();
  readonly usesDatabase: boolean;

  #pendingActivation = false;
  #dataGovernanceStorage?: DataGovernanceStorage;
  readonly #fileProjectKnowledgeJournal: FileProjectKnowledgeJournal;
  readonly #fileOverlayPackPromotions: FileOverlayPackPromotionRepository;
  readonly #filePortfolioControlOutbox: FilePortfolioControlOutboxRepository;

  constructor(private readonly options: WorkroomPersistenceCoordinatorOptions) {
    this.stateRoot = join(options.projectRoot, '.zhin');
    this.usesDatabase = options.config.sessions?.useDatabase !== false;
    assertFixedWorkroomStorageMode(
      options.fixedStorageMode,
      resolveWorkroomStorageMode(options.config),
    );
    this.#fileProjectKnowledgeJournal = new FileProjectKnowledgeJournal(
      join(this.stateRoot, 'workroom-project-knowledge'),
    );
    this.#fileOverlayPackPromotions = new FileOverlayPackPromotionRepository(
      join(this.stateRoot, 'workroom-overlay-pack-promotions'),
    );
    this.#filePortfolioControlOutbox = new FilePortfolioControlOutboxRepository(
      join(this.stateRoot, 'portfolio-control-outbox'),
    );
  }

  get pendingActivation(): boolean {
    return this.#pendingActivation;
  }

  bindDataGovernanceStorage(storage: DataGovernanceStorage): void {
    if (this.#dataGovernanceStorage) {
      throw new Error('Workroom data governance storage is already bound');
    }
    this.#dataGovernanceStorage = storage;
  }

  async prepare(): Promise<void> {
    if (this.usesDatabase) {
      this.#prepareDatabaseActivation();
      return;
    }
    if (this.options.semanticMemory) {
      throw new Error('ai.memory.semantic.enabled requires the Database Root Host');
    }
    await this.#activateFilePersistence();
    this.options.agent.markMemoryPersistenceReady();
  }

  #prepareDatabaseActivation(): void {
    const { resources } = this.options;
    if (!resources.has(databaseRootHostToken)) {
      throw new Error('Process-fixed Workroom database storage requires the Database Root Host');
    }
    const database = resources.use(databaseRootHostToken);
    try {
      const tableCount = defineAiDatabaseModels((name, definition) => {
        database.define(name, definition);
      });
      this.#pendingActivation = true;
      this.options.handoff.add({
        activateNext: async signal => {
          signal.throwIfAborted();
          try {
            const raw = database.getRawDatabase();
            if (!raw) throw new Error('Agent persistence requires an active database connection');
            await activateAiDatabaseStorage(
              raw,
              { aiService: this.options.service, zhinAgent: this.options.agent },
              this.options.config,
              this.options.journal,
              this.options.journalPayloads,
              this.options.catalog,
              this.options.semanticMemory,
            );
            await this.#activateDatabaseRepositories(raw, signal);
            await assertWorkroomCatalogMatchesGeneration(
              this.options.catalog,
              this.options.listAgentNames(),
              await this.options.resolveConfiguredEndpointKeys?.(),
            );
            await this.options.recoverHumanIngress();
            signal.throwIfAborted();
            getLogger('agent').info(formatCompact({
              op: 'agent_host_persistence',
              mode: 'database',
              tables: tableCount,
            }));
          } catch (error) {
            throw new Error('Agent database persistence activation failed', { cause: error });
          } finally {
            this.options.agent.markMemoryPersistenceReady();
          }
        },
      });
    } catch (error) {
      throw new Error('Agent database model registration failed', { cause: error });
    }
  }

  async #activateDatabaseRepositories(
    raw: NonNullable<ReturnType<DatabaseHost['getRawDatabase']>>,
    signal: AbortSignal,
  ): Promise<void> {
    const grantModel = raw.models?.get('workroom_assignment_authority_grants');
    if (!grantModel) throw new Error('Workroom requires the Assignment Authority Grant database model');
    this.assignmentAuthorityGrants.activate(new DatabaseAssignmentAuthorityGrantRepository(
      raw as ConstructorParameters<typeof DatabaseAssignmentAuthorityGrantRepository>[0],
      grantModel as ConstructorParameters<typeof DatabaseAssignmentAuthorityGrantRepository>[1],
    ));

    const catalogSnapshot = await this.options.catalog.read();
    const projectIds = Object.keys(catalogSnapshot.definitions).sort();
    const governanceStorage = this.#dataGovernanceStorage;
    if (governanceStorage) {
      await governanceStorage.activateDatabase({
        database: raw,
        projectIds,
        repositoryIdentity: 'database-root:primary',
        signal,
      });
    }

    const knowledgeModel = raw.models?.get('workroom_project_knowledge');
    const promotionModel = raw.models?.get('workroom_overlay_pack_promotions');
    if (!knowledgeModel || !promotionModel) {
      throw new Error('Workroom requires the Project Knowledge and Overlay Promotion database models');
    }
    const databaseKnowledge = new DatabaseProjectKnowledgeJournal(
      raw as ConstructorParameters<typeof DatabaseProjectKnowledgeJournal>[0],
      knowledgeModel as ConstructorParameters<typeof DatabaseProjectKnowledgeJournal>[1],
    );
    await this.projectKnowledgeJournal.activate(
      databaseKnowledge,
      projectIds,
      this.#fileProjectKnowledgeJournal,
    );
    const databasePromotions = new DatabaseOverlayPackPromotionRepository(
      raw as ConstructorParameters<typeof DatabaseOverlayPackPromotionRepository>[0],
      promotionModel as ConstructorParameters<typeof DatabaseOverlayPackPromotionRepository>[1],
    );
    const promotionIds = await this.#collectPromotionIds(projectIds, databasePromotions);
    await this.overlayPackPromotions.activate(
      databasePromotions,
      promotionIds,
      this.#fileOverlayPackPromotions,
    );

    const portfolioControlModel = raw.models?.get('portfolio_control_outbox');
    if (!portfolioControlModel) {
      throw new Error('Workroom requires the Portfolio Control Outbox database model');
    }
    const portfolioRepository = this.options.resources.has(portfolioJournalRepositoryToken)
      ? this.options.resources.use(portfolioJournalRepositoryToken)
      : undefined;
    const portfolioIds = new Set([
      ...await this.#filePortfolioControlOutbox.listPortfolioIds(),
      ...(portfolioRepository ? await portfolioRepository.listPortfolioIds() : []),
    ]);
    await this.portfolioControlOutbox.activate(
      new DatabasePortfolioControlOutboxRepository(
        raw as ConstructorParameters<typeof DatabasePortfolioControlOutboxRepository>[0],
        portfolioControlModel as ConstructorParameters<typeof DatabasePortfolioControlOutboxRepository>[1],
      ),
      [...portfolioIds].sort(),
      this.#filePortfolioControlOutbox,
    );
  }

  async #activateFilePersistence(): Promise<void> {
    if (!this.options.journal.active) {
      this.options.journal.activate(new FileWorkroomJournal(
        join(this.stateRoot, 'workroom-journal'),
        this.options.journalPayloads,
      ));
    }
    this.options.catalog.activate(new FileWorkroomCatalog(
      join(this.stateRoot, 'workroom-catalog.json'),
    ));
    await assertWorkroomCatalogMatchesGeneration(
      this.options.catalog,
      this.options.listAgentNames(),
      await this.options.resolveConfiguredEndpointKeys?.(),
    );
    this.assignmentAuthorityGrants.activate(new FileAssignmentAuthorityGrantRepository(
      join(this.stateRoot, 'workroom-assignment-authority-grants'),
    ));
    const projectIds = Object.keys((await this.options.catalog.read()).definitions).sort();
    await this.projectKnowledgeJournal.activate(this.#fileProjectKnowledgeJournal, projectIds);
    const promotionIds = await this.#collectPromotionIds(projectIds);
    await this.overlayPackPromotions.activate(this.#fileOverlayPackPromotions, promotionIds);
    await this.portfolioControlOutbox.activate(
      this.#filePortfolioControlOutbox,
      await this.#filePortfolioControlOutbox.listPortfolioIds(),
    );
  }

  async #collectPromotionIds(
    projectIds: readonly string[],
    database?: DatabaseOverlayPackPromotionRepository,
  ): Promise<readonly string[]> {
    const promotionIds = new Set<string>();
    for (const projectId of projectIds) {
      for (const record of await this.#fileOverlayPackPromotions.list(projectId)) {
        promotionIds.add(record.promotionId);
      }
      if (database) {
        for (const record of await database.list(projectId)) promotionIds.add(record.promotionId);
      }
    }
    return [...promotionIds].sort();
  }
}
