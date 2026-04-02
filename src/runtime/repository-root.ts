import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

const repositoryRootCache = new Map<string, string>();

const resolveGitCommonDir = (cwd: string): string | null => {
  const normalizedCwd = resolve(cwd);
  const cached = repositoryRootCache.get(normalizedCwd);
  if (cached) {
    return cached;
  }

  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: normalizedCwd,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    repositoryRootCache.set(normalizedCwd, normalizedCwd);
    return normalizedCwd;
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    repositoryRootCache.set(normalizedCwd, normalizedCwd);
    return normalizedCwd;
  }

  const commonDir = resolve(normalizedCwd, output);
  const repositoryRoot = basename(commonDir) === ".git" ? dirname(commonDir) : normalizedCwd;
  repositoryRootCache.set(normalizedCwd, repositoryRoot);
  return repositoryRoot;
};

export const resolveRepositoryRoot = (cwd: string): string => resolveGitCommonDir(cwd) ?? resolve(cwd);

export const resolveRepositoryProfileRoot = (cwd: string): string =>
  join(resolveRepositoryRoot(cwd), ".webenvoy", "profiles");
