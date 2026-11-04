import { DataMigrationError, type JsonValue } from 'zhin.js/plugin-runtime';

export interface SubscriptionMigrationJournal {
  readonly planDigest: string;
  readonly candidateId: string;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly recordCount: number;
  readonly scopes: readonly string[];
  readonly phase: 'pausing' | 'applied' | 'restoring' | 'restored' | 'rejected' | 'resumed';
  readonly operation?: 'apply' | 'restore';
  readonly rejectedDigest?: string;
}
export interface SubscriptionDocument {
  readonly format: 'earthquake-subscriptions-v2';
  readonly subscriptions: readonly JsonValue[];
  readonly migrations: Readonly<Record<string, SubscriptionMigrationJournal>>;
}
export function subscriptionDocument(value: unknown): SubscriptionDocument {
  if (value === undefined) return { format: 'earthquake-subscriptions-v2', subscriptions: [], migrations: {} };
  if (Array.isArray(value)) return { format: 'earthquake-subscriptions-v2', subscriptions: value, migrations: {} };
  if (
    value &&
    typeof value === 'object' &&
    'format' in value &&
    value.format === 'earthquake-subscriptions-v2' &&
    'subscriptions' in value &&
    Array.isArray(value.subscriptions) &&
    'migrations' in value &&
    value.migrations &&
    typeof value.migrations === 'object' &&
    !Array.isArray(value.migrations)
  )
    return value as SubscriptionDocument;
  throw new DataMigrationError('unsupported', 'Earthquake subscriptions have an unrecognized storage format');
}
