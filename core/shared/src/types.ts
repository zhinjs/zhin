export type Dict<T = any, K extends string | symbol = string> = Record<K, T>;
export type Define<D extends Dict, K extends string, V extends any = any> = {
  [P in K | keyof D]: P extends keyof D ? D[P] : P extends K ? V : unknown;
};
export type Merge<First, Second> = {
  [Key in keyof (First & Second)]: Key extends keyof Second
    ? Second[Key]
    : Key extends keyof First
    ? First[Key]
    : never;
};
export type Awaitable<R extends any = void> = R | Promise<R>;
export type PackageJson = {
  main: string;
  name: string;
  version?: string;
  using?: string[];
  setup?: boolean;
};
