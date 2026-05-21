import fs from "node:fs";
import path from "node:path";
import type { ProjectFs, ProjectFsDirEntry, ProjectFsStat } from "./context.js";

const ENV_WHITELIST = [".env", ".env.development", ".env.production"];

function nodeStat(filePath: string): ProjectFsStat | null {
  try {
    const s = fs.statSync(filePath);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size };
  } catch {
    return null;
  }
}

export function createNodeProjectFs(cwd = process.cwd()): ProjectFs {
  return {
    cwd: () => cwd,
    exists: (filePath) => fs.existsSync(filePath),
    readText: (filePath) => fs.readFileSync(filePath, "utf-8"),
    writeText: (filePath, content) => fs.writeFileSync(filePath, content, "utf-8"),
    stat: nodeStat,
    readDir: (dirPath) => {
      const entries: ProjectFsDirEntry[] = [];
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        entries.push({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        });
      }
      return entries;
    },
    mkdirp: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  };
}

type DenoFileInfo = { isFile: boolean; isDirectory: boolean; size: number };

type DenoLike = {
  statSync(path: string): DenoFileInfo;
  readTextFileSync(path: string): string;
  writeTextFileSync(path: string, content: string): void;
};

function getDeno(): DenoLike {
  const d = (globalThis as { Deno?: DenoLike }).Deno;
  if (!d) throw new Error("createDenoProjectFs requires a Deno runtime");
  return d;
}

/** Deno / Edge：相对 playground 或 Deploy 项目根 */
export function createDenoProjectFs(projectRoot: string): ProjectFs {
  const root = projectRoot.replace(/\/$/, "");
  return {
    cwd: () => root,
    exists: (filePath) => {
      try {
        getDeno().statSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
    readText: (filePath) => getDeno().readTextFileSync(filePath),
    writeText: (filePath, content) => getDeno().writeTextFileSync(filePath, content),
    stat: (filePath) => {
      try {
        const s = getDeno().statSync(filePath);
        return { isFile: s.isFile, isDirectory: s.isDirectory, size: s.size };
      } catch {
        return nodeStat(filePath);
      }
    },
    readDir: (dirPath) => {
      try {
        const entries: ProjectFsDirEntry[] = [];
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
          entries.push({
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
          });
        }
        return entries;
      } catch {
        return [];
      }
    },
    mkdirp: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  };
}

export function listEnvFiles(projectFs: ProjectFs): { name: string; exists: boolean }[] {
  const cwd = projectFs.cwd();
  return ENV_WHITELIST.map((name) => ({
    name,
    exists: projectFs.exists(path.resolve(cwd, name)),
  }));
}

export function resolveEnvPath(projectFs: ProjectFs, filename: string): string | null {
  if (!ENV_WHITELIST.includes(filename)) return null;
  return path.resolve(projectFs.cwd(), filename);
}
