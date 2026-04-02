import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface NativeHostInstallRoots {
  installScope: "worktree_scoped_bundle";
  installKey: string | null;
  repositoryRoot: string;
  worktreePath: string;
  channelRoot: string;
  manifestRoot: string;
  launcherRoot: string;
  runtimeRoot: string;
}

export interface ManagedNativeHostInstall {
  installScope: "worktree_scoped_bundle";
  installKey: string | null;
  channelRoot: string;
  launcherRoot: string;
  runtimeRoot: string;
}

const resolveExistingPath = (input: string): string => {
  const normalized = resolve(input);
  try {
    return realpathSync.native(normalized);
  } catch {
    return normalized;
  }
};

const resolveGitPaths = (cwd: string): { repositoryRoot: string; worktreePath: string } | null => {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], {
    cwd,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return null;
  }

  const outputLines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (outputLines.length < 2) {
    return null;
  }

  const worktreePath = resolveExistingPath(outputLines[0]);
  const commonDir = resolveExistingPath(outputLines[1]);
  const repositoryRoot = basename(commonDir) === ".git" ? dirname(commonDir) : null;
  if (!repositoryRoot) {
    return null;
  }

  return {
    repositoryRoot,
    worktreePath
  };
};

const sanitizeInstallLabel = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "worktree";
};

const buildInstallKey = (worktreePath: string): string => {
  const digest = createHash("sha256").update(worktreePath).digest("hex").slice(0, 12);
  return `${sanitizeInstallLabel(basename(worktreePath))}-${digest}`;
};

export const resolveNativeHostInstallRoots = (
  cwd: string,
  browserChannel: string
): NativeHostInstallRoots => {
  const fallbackPath = resolveExistingPath(cwd);
  const gitPaths = resolveGitPaths(fallbackPath);
  const worktreePath = gitPaths?.worktreePath ?? fallbackPath;
  const repositoryRoot = gitPaths?.repositoryRoot ?? fallbackPath;
  const installKey = gitPaths ? buildInstallKey(worktreePath) : null;
  const sharedRepositoryRoot = repositoryRoot ?? worktreePath;
  const channelRoot = installKey
    ? join(
        sharedRepositoryRoot,
        ".webenvoy",
        "native-host-install",
        "worktrees",
        installKey,
        browserChannel
      )
    : join(worktreePath, ".webenvoy", "native-host-install", browserChannel);

  return {
    installScope: "worktree_scoped_bundle",
    installKey,
    repositoryRoot: sharedRepositoryRoot,
    worktreePath,
    channelRoot,
    manifestRoot: join(channelRoot, "manifests"),
    launcherRoot: join(channelRoot, "bin"),
    runtimeRoot: join(channelRoot, "runtime")
  };
};

export const inspectManagedNativeHostInstall = (
  launcherPath: string
): ManagedNativeHostInstall | null => {
  const normalizedLauncherPath = resolve(launcherPath);
  const launcherRoot = dirname(normalizedLauncherPath);
  if (basename(launcherRoot) !== "bin") {
    return null;
  }

  const channelRoot = dirname(launcherRoot);
  const nativeHostInstallDir = dirname(channelRoot);
  const directFallbackWebEnvoyDir = dirname(nativeHostInstallDir);
  if (
    basename(nativeHostInstallDir) === "native-host-install" &&
    basename(directFallbackWebEnvoyDir) === ".webenvoy"
  ) {
    return {
      installScope: "worktree_scoped_bundle",
      installKey: null,
      channelRoot,
      launcherRoot,
      runtimeRoot: join(channelRoot, "runtime")
    };
  }

  const installKeyDir = dirname(channelRoot);
  const worktreesDir = dirname(installKeyDir);
  const keyedNativeHostInstallDir = dirname(worktreesDir);
  const webEnvoyDir = dirname(keyedNativeHostInstallDir);

  if (
    basename(worktreesDir) !== "worktrees" ||
    basename(keyedNativeHostInstallDir) !== "native-host-install" ||
    basename(webEnvoyDir) !== ".webenvoy"
  ) {
    return null;
  }

  const installKey = basename(installKeyDir);
  if (installKey.length === 0) {
    return null;
  }

  return {
    installScope: "worktree_scoped_bundle",
    installKey,
    channelRoot,
    launcherRoot,
    runtimeRoot: join(channelRoot, "runtime")
  };
};
