export interface NavNode {
  readonly id: string;
  readonly type: 'plugin' | 'page';
  readonly label: string;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en', string>>>;
  readonly icon?: string;
  readonly path?: string;
  readonly order: number;
  readonly children: readonly NavNode[];
}

export interface AccessSnapshot {
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
  /** The operator (full-scope token, or a Host without tokens): every Page is allowed. */
  readonly unrestricted?: boolean;
}
