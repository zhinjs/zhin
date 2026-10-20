/**
 * Prepare and activate Workroom journal/catalog database storage.
 */
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  type WorkroomJournalPayloadPort,
} from '../workroom/journal/index.js';
import { ActivatableWorkroomCatalog, DatabaseWorkroomCatalog } from '../workroom/catalog.js';

export interface PreparedWorkroomDatabaseStorage {
  activate(workroomJournal: ActivatableWorkroomJournal, workroomCatalog: ActivatableWorkroomCatalog): void;
}

/**
 * Validates persisted authority (scans stored journal headers) without mutating
 * any runtime port. Call before mutating candidate runtime ports, then `activate`.
 */
export async function prepareWorkroomDatabaseStorage(
  db: any,
  workroomJournalPayloads: WorkroomJournalPayloadPort,
): Promise<PreparedWorkroomDatabaseStorage> {
  const workroomEventModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseWorkroomJournal>[1]>(
    db,
    'workroom_events',
  );
  const workroomCatalogModel = requireDatabaseModel<ConstructorParameters<typeof DatabaseWorkroomCatalog>[1]>(
    db,
    'workroom_catalog',
  );
  const databaseWorkroomJournal = new DatabaseWorkroomJournal(
    db,
    workroomEventModel,
    workroomJournalPayloads,
  );
  // Validate persisted authority before mutating any candidate runtime port.
  await databaseWorkroomJournal.scanStoredHeaders();
  const databaseWorkroomCatalog = new DatabaseWorkroomCatalog(db, workroomCatalogModel);
  return {
    activate(workroomJournal, workroomCatalog) {
      workroomJournal.activate(databaseWorkroomJournal);
      workroomCatalog.activate(databaseWorkroomCatalog);
    },
  };
}

function requireDatabaseModel<T>(
  db: { models?: { get(name: string): unknown } },
  name: string,
): T {
  const model = db.models?.get(name) as T | undefined;
  if (!model) throw new Error(`Agent database activation requires the ${name} model`);
  return model;
}
