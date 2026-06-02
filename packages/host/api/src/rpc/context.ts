import type { Plugin } from "@zhin.js/core";

export type ProjectFsStat = {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
};

export type ProjectFsDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

export type ProjectFs = {
  cwd(): string;
  exists(filePath: string): boolean;
  readText(filePath: string): string;
  writeText(filePath: string, content: string): void;
  stat(filePath: string): ProjectFsStat | null;
  readDir(dirPath: string): ProjectFsDirEntry[];
  mkdirp(dirPath: string): void;
};

export type ConsoleWebServer = {
  entries?: Record<string, string>;
};

export type ConsoleRpcContext = {
  root: Plugin;
  webServer: ConsoleWebServer;
  projectFs: ProjectFs;
  emit: (payload: Record<string, unknown>) => void;
};
