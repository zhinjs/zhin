export type Database = {
  get<T = any>(key: string, defaultValue?: T): Promise<T>;
  filter<T>(key: string, predicate: Database.Predicate<T>): Promise<T>;
  find<T>(key: string, predicate: Database.Predicate<T>): Promise<Database.ArrayItem<T>>;
  indexOf<T>(key: string, predicate: Database.Predicate<T>): Promise<T>;
  includes<T>(key: string, predicate: Database.Predicate<T>): Promise<boolean>;
  set<T>(key: string, value: T): Promise<void>;
  replace<T>(key: string, oldValue: T, newValue: T): Promise<boolean>;
  replace<T>(key: string, predicate: Database.Predicate<T[]>, value: T): Promise<boolean>;
  splice<T>(key: string, index: number, deleteCount: number, ...insert: T[]): Promise<void>;
  remove<T>(key: string, predicate: T): Promise<void>;
  remove<T>(key: string, predicate: Database.Predicate<T[]>): Promise<void>;
  push<T>(key: string, ...value: T[]): Promise<void>;
  import<T extends object>(data: T): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  export(filename: string): Promise<boolean>;
};
export namespace Database {
  export type Predicate<T> = T extends (infer L)[] ? (item: L, index: number, list: T) => boolean : never;
  export type ArrayItem<T> = T extends (infer L)[] ? L : unknown;
}
