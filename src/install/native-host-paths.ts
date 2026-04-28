import { access, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CliError } from "../core/errors.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "../runtime/native-messaging/host.js";
import {
  type BrowserChannel,
  resolveManifestDiscoveryDirectory
} from "./native-host-platform.js";
import { resolveNativeHostInstallRoots } from "./native-host-install-root.js";

export type InstallPathSource = "repo_owned_default" | "browser_default" | "custom";

const asAbsolutePath = (cwd: string, input: string): string =>
  isAbsolute(input) ? input : resolve(cwd, input);

export const nativeHostPathError = (
  abilityId: "runtime.install" | "runtime.uninstall",
  reason: string,
  details: Record<string, unknown>
): CliError =>
  new CliError("ERR_CLI_INVALID_ARGS", "安装命令参数不合法", {
    details: {
      ability_id: abilityId,
      stage: "input_validation",
      reason,
      ...details
    }
  });

export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const assertNotSymlink = async (
  command: "runtime.install" | "runtime.uninstall",
  field: "manifest_path" | "launcher_path",
  targetPath: string
): Promise<void> => {
  try {
    const stat = await lstat(targetPath);
    if (!stat.isSymbolicLink()) {
      return;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return;
    }
    throw error;
  }

  throw nativeHostPathError(command, "INSTALL_PATH_SYMBOLIC_LINK", {
    field,
    received_path: targetPath
  });
};

export const assertNoSymlinkAncestorBetween = async (input: {
  command: "runtime.install" | "runtime.uninstall";
  field: "manifest_dir" | "launcher_path" | "profile_dir";
  fromDir: string;
  targetDir: string;
}): Promise<void> => {
  const normalizedFrom = normalizePathForBoundaryCheck(input.fromDir);
  const normalizedTarget = normalizePathForBoundaryCheck(input.targetDir);
  const rel = relative(normalizedFrom, normalizedTarget);
  const isInside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!isInside) {
    return;
  }
  const segments =
    rel === "" ? [] : rel.split(sep).filter((segment) => segment.length > 0 && segment !== ".");
  let current = normalizedFrom;

  try {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw nativeHostPathError(input.command, "INSTALL_PATH_PARENT_SYMBOLIC_LINK", {
        field: input.field,
        received_path: current
      });
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (!stat.isSymbolicLink()) {
        continue;
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    throw nativeHostPathError(input.command, "INSTALL_PATH_PARENT_SYMBOLIC_LINK", {
      field: input.field,
      received_path: current
    });
  }
};

export const resolveProfileRoot = (cwd: string): string => resolve(cwd, ".webenvoy", "profiles");

export const resolveProfileScopedNativeBridgeSocketPath = (profileDir: string): string =>
  join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME);

export const resolveControlledInstallRoots = (cwd: string, browserChannel: BrowserChannel) =>
  resolveNativeHostInstallRoots(cwd, browserChannel);

export const resolveRepoOwnedManifestPath = (
  cwd: string,
  browserChannel: BrowserChannel,
  nativeHostName: string
): string => join(resolveControlledInstallRoots(cwd, browserChannel).manifestRoot, `${nativeHostName}.json`);

export const resolveRepoOwnedLauncherPath = (
  cwd: string,
  browserChannel: BrowserChannel,
  nativeHostName: string
): string => join(resolveControlledInstallRoots(cwd, browserChannel).launcherRoot, `${nativeHostName}-launcher`);

export const resolveLegacyDefaultLauncherPath = (
  manifestDir: string,
  nativeHostName: string
): string => join(manifestDir, `${nativeHostName}-launcher`);

export const normalizePathForBoundaryCheck = (input: string): string => {
  const normalized = resolve(input);
  return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized;
};

const isPathInside = (baseDir: string, targetPath: string): boolean => {
  const normalizedBase = normalizePathForBoundaryCheck(baseDir);
  const normalizedTarget = normalizePathForBoundaryCheck(targetPath);
  const rel = relative(normalizedBase, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export const normalizePathForOutput = (input: string | null | undefined): string | null =>
  typeof input === "string" ? normalizePathForBoundaryCheck(input) : null;

const canonicalizeProfileDirForLauncher = (profileRoot: string, profileDir: string): string => {
  const normalizedRoot = normalizePathForBoundaryCheck(profileRoot);
  const normalizedProfileDir = normalizePathForBoundaryCheck(profileDir);
  const profileKey = relative(normalizedRoot, normalizedProfileDir);
  return profileKey.length > 0 ? resolve(profileRoot, profileKey) : resolve(profileRoot);
};

export interface ResolveInstallPathsInput {
  command: "runtime.install" | "runtime.uninstall";
  cwd: string;
  nativeHostName: string;
  browserChannel: BrowserChannel;
  manifestDir?: string;
  launcherPath?: string;
  platform?: NodeJS.Platform;
}

export const resolveInstallPaths = (input: ResolveInstallPathsInput) => {
  const roots = resolveControlledInstallRoots(input.cwd, input.browserChannel);
  const platform = input.platform ?? process.platform;
  const hasCustomManifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0;
  const manifestDiscoveryRoot =
    platform === "win32"
      ? roots.manifestRoot
      : resolveManifestDiscoveryDirectory(input.browserChannel, platform);
  const manifestDir =
    hasCustomManifestDir
      ? asAbsolutePath(input.cwd, input.manifestDir!)
      : platform === "win32"
        ? roots.manifestRoot
        : manifestDiscoveryRoot;
  if (hasCustomManifestDir && platform !== "win32" && !isPathInside(manifestDiscoveryRoot, manifestDir)) {
    throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
      field: "manifest_dir",
      allowed_root: manifestDiscoveryRoot,
      received_path: manifestDir
    });
  }

  const manifestPath = join(manifestDir, `${input.nativeHostName}.json`);
  const launcherPath =
    typeof input.launcherPath === "string" && input.launcherPath.length > 0
      ? asAbsolutePath(input.cwd, input.launcherPath)
      : resolveRepoOwnedLauncherPath(input.cwd, input.browserChannel, input.nativeHostName);
  const hasCustomLauncherPath = typeof input.launcherPath === "string" && input.launcherPath.length > 0;
  if (hasCustomLauncherPath && !isPathInside(roots.launcherRoot, launcherPath)) {
    throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
      field: "launcher_path",
      allowed_root: roots.launcherRoot,
      received_path: launcherPath
    });
  }

  return {
    installScope: roots.installScope,
    installKey: roots.installKey,
    channelRoot: roots.channelRoot,
    worktreePath: roots.worktreePath,
    manifestRoot: manifestDiscoveryRoot,
    manifestDir,
    manifestPath,
    runtimeRoot: roots.runtimeRoot,
    launcherRoot: roots.launcherRoot,
    launcherPath,
    hasCustomManifestDir,
    hasCustomLauncherPath,
    manifestPathSource: hasCustomManifestDir
      ? ("custom" as InstallPathSource)
      : platform === "win32"
        ? ("repo_owned_default" as InstallPathSource)
        : ("browser_default" as InstallPathSource),
    launcherPathSource: hasCustomLauncherPath ? ("custom" as InstallPathSource) : ("repo_owned_default" as InstallPathSource)
  };
};

export const resolveProfileDirForLauncher = (input: {
  command: "runtime.install" | "runtime.uninstall";
  cwd: string;
  profileRoot: string;
  profileDir?: string;
}): string | undefined => {
  if (typeof input.profileDir !== "string" || input.profileDir.trim().length === 0) {
    return undefined;
  }
  const normalizedProfileDir = asAbsolutePath(input.cwd, input.profileDir.trim());
  if (!isPathInside(input.profileRoot, normalizedProfileDir)) {
    throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
      field: "profile_dir",
      allowed_root: input.profileRoot,
      received_path: normalizedProfileDir
    });
  }
  return normalizedProfileDir;
};

export const resolveLegacyProfileDirForLauncher = (profileRoot: string, profileDir: string): string =>
  canonicalizeProfileDirForLauncher(profileRoot, profileDir);

export const validateNativeHostInstallPaths = async (input: {
  command: "runtime.install" | "runtime.uninstall";
  resolvedPaths: ReturnType<typeof resolveInstallPaths>;
  profileRoot: string;
  profileDir?: string;
}): Promise<void> => {
  await assertNoSymlinkAncestorBetween({
    command: input.command,
    field: "manifest_dir",
    fromDir: input.resolvedPaths.manifestRoot,
    targetDir: input.resolvedPaths.manifestDir
  });
  await assertNoSymlinkAncestorBetween({
    command: input.command,
    field: "launcher_path",
    fromDir: input.resolvedPaths.launcherRoot,
    targetDir: dirname(input.resolvedPaths.launcherPath)
  });
  if (typeof input.profileDir === "string") {
    await assertNoSymlinkAncestorBetween({
      command: input.command,
      field: "profile_dir",
      fromDir: input.profileRoot,
      targetDir: input.profileDir
    });
  }
  await assertNotSymlink(input.command, "manifest_path", input.resolvedPaths.manifestPath);
  await assertNotSymlink(input.command, "launcher_path", input.resolvedPaths.launcherPath);
};
