export interface NavNode {
  readonly id: string;
  readonly type: 'plugin' | 'page';
  readonly label: string;
  readonly icon?: string;
  readonly path?: string;
  readonly order: number;
  readonly children: readonly NavNode[];
}

export interface AccessSnapshot {
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}
