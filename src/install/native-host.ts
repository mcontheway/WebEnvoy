import { chmod, copyFile, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectManagedNativeHostInstall } from "./native-host-install-root.js";
import {
  type BrowserChannel,
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_NATIVE_HOST_NAME,
  EXTENSION_ID_PATTERN,
  isBrowserChannel,
  isValidExtensionId,
  isValidNativeHostName
} from "./native-host-platform.js";
import {
  type InstallPathSource,
  assertNoSymlinkAncestorBetween,
  assertNotSymlink,
  nativeHostPathError,
  normalizePathForBoundaryCheck,
  normalizePathForOutput,
  pathExists,
  resolveInstallPaths,
  resolveLegacyDefaultLauncherPath,
  resolveLegacyProfileDirForLauncher,
  resolveProfileDirForLauncher,
  resolveProfileRoot,
  resolveProfileScopedNativeBridgeSocketPath,
  validateNativeHostInstallPaths
} from "./native-host-paths.js";

export {
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_NATIVE_HOST_NAME,
  isBrowserChannel,
  isValidExtensionId,
  isValidNativeHostName
} from "./native-host-platform.js";

const NATIVE_HOST_DESCRIPTION = "WebEnvoy CLI ↔ Extension bridge";
const MANAGED_INSTALL_METADATA_FILENAME = "install-metadata.json";

const quoteShellToken = (value: string): string => JSON.stringify(value);

const quoteShellArgForScript = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

const tokenizeHostCommand = (
  command: "runtime.install" | "runtime.uninstall",
  hostCommand: string
): string[] => {
  const tokens: string[] = [];
  let current = "";
  let index = 0;
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current.length === 0) {
      return;
    }
    tokens.push(current);
    current = "";
  };

  while (index < hostCommand.length) {
    const char = hostCommand[index];

    if (quote === null) {
      if (/\s/.test(char)) {
        pushCurrent();
        index += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        index += 1;
        continue;
      }
      if (char === "\\") {
        const next = hostCommand[index + 1];
        if (typeof next !== "string") {
          throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
            field: "host_command"
          });
        }
        current += next;
        index += 2;
        continue;
      }
      if ("|&;<>$`()\n\r".includes(char)) {
        throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
          field: "host_command"
        });
      }
      current += char;
      index += 1;
      continue;
    }

    if (char === quote) {
      quote = null;
      index += 1;
      continue;
    }

    if (quote === '"' && char === "\\") {
      const next = hostCommand[index + 1];
      if (typeof next !== "string") {
        throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
          field: "host_command"
        });
      }
      current += next;
      index += 2;
      continue;
    }

    current += char;
    index += 1;
  }

  if (quote !== null) {
    throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
      field: "host_command"
    });
  }

  pushCurrent();
  if (tokens.length === 0) {
    throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
      field: "host_command"
    });
  }
  return tokens;
};

const resolveCurrentBuildNativeHostRuntimePaths = () => {
  const distInstallDir = dirname(fileURLToPath(import.meta.url));
  const distRuntimeDir = resolve(distInstallDir, "..", "runtime");
  return {
    entryPath: join(distRuntimeDir, "native-messaging", "native-host-entry.js"),
    protocolPath: join(distRuntimeDir, "native-messaging", "protocol.js"),
    hostPath: join(distRuntimeDir, "native-messaging", "host.js"),
    worktreeRootPath: join(distRuntimeDir, "worktree-root.js")
  };
};

const resolveBundledNativeHostRuntimePaths = (channelRoot: string) => {
  const runtimeRoot = join(channelRoot, "runtime");
  return {
    runtimeRoot,
    entryPath: join(runtimeRoot, "native-messaging", "native-host-entry.js"),
    protocolPath: join(runtimeRoot, "native-messaging", "protocol.js"),
    hostPath: join(runtimeRoot, "native-messaging", "host.js"),
    worktreeRootPath: join(runtimeRoot, "worktree-root.js"),
    packageJsonPath: join(runtimeRoot, "package.json")
  };
};

const installBundledNativeHostRuntime = async (channelRoot: string): Promise<string> => {
  const source = resolveCurrentBuildNativeHostRuntimePaths();
  const target = resolveBundledNativeHostRuntimePaths(channelRoot);
  await mkdir(dirname(target.entryPath), { recursive: true });
  await copyFile(source.entryPath, target.entryPath);
  await copyFile(source.protocolPath, target.protocolPath);
  await copyFile(source.hostPath, target.hostPath);
  await copyFile(source.worktreeRootPath, target.worktreeRootPath);
  await writeFile(target.packageJsonPath, `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
  return target.entryPath;
};

export const resolveRepoOwnedNativeHostEntryPath = (): string =>
  resolveCurrentBuildNativeHostRuntimePaths().entryPath;

const PROFILE_MODE_ROOT_PREFERRED = "profile_root_preferred";

export const resolveRepoOwnedNativeHostCommand = (): string =>
  `${quoteShellToken(process.execPath)} ${quoteShellToken(resolveRepoOwnedNativeHostEntryPath())}`;

interface NativeHostRegistrationManifest {
  name: string | null;
  launcherPath: string | null;
  allowedOrigins: string[];
}

interface ManagedInstallMetadataRecord {
  profile_root: string;
  bundle_runtime_expected: boolean;
}

const readNativeHostRegistrationManifest = async (
  manifestPath: string
): Promise<NativeHostRegistrationManifest | null> => {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const launcherPath =
      typeof parsed.path === "string" && parsed.path.trim().length > 0
        ? (isAbsolute(parsed.path) ? parsed.path : resolve(dirname(manifestPath), parsed.path))
        : null;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : null,
      launcherPath,
      allowedOrigins: Array.isArray(parsed.allowed_origins)
        ? parsed.allowed_origins.filter((entry): entry is string => typeof entry === "string")
        : []
    };
  } catch {
    return null;
  }
};

const buildLauncherScript = (input: {
  command: "runtime.install" | "runtime.uninstall";
  hostCommand: string;
  profileRoot?: string;
  legacyProfileDir?: string;
  profileMode?: string;
}): string => {
  const argv = tokenizeHostCommand(input.command, input.hostCommand)
    .map((token) => quoteShellArgForScript(token))
    .join(" ");
  const profileRootExport =
    typeof input.profileRoot === "string" && input.profileRoot.length > 0
      ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT=${quoteShellArgForScript(input.profileRoot)}\n`
      : "";
  const legacyProfileDirExport =
    typeof input.legacyProfileDir === "string" && input.legacyProfileDir.length > 0
      ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR=${quoteShellArgForScript(input.legacyProfileDir)}\n`
      : "";
  const profileModeExport =
    typeof input.profileMode === "string" && input.profileMode.length > 0
      ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE=${quoteShellArgForScript(input.profileMode)}\n`
      : "";

  return `#!/usr/bin/env bash
set -euo pipefail
${profileRootExport}${legacyProfileDirExport}${profileModeExport}exec ${argv} "$@"
`;
};

const writeManagedInstallMetadata = async (input: {
  channelRoot: string;
  profileRoot: string;
  bundleRuntimeExpected: boolean;
}): Promise<void> => {
  const metadata: ManagedInstallMetadataRecord = {
    profile_root: input.profileRoot,
    bundle_runtime_expected: input.bundleRuntimeExpected
  };
  await writeFile(
    join(input.channelRoot, MANAGED_INSTALL_METADATA_FILENAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
};

const readManagedInstallMetadata = async (
  channelRoot: string
): Promise<ManagedInstallMetadataRecord | null> => {
  try {
    const raw = await readFile(join(channelRoot, MANAGED_INSTALL_METADATA_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profileRoot =
      typeof parsed.profile_root === "string" && parsed.profile_root.trim().length > 0
        ? parsed.profile_root.trim()
        : null;
    if (!profileRoot) {
      return null;
    }
    return {
      profile_root: profileRoot,
      bundle_runtime_expected: parsed.bundle_runtime_expected === true
    };
  } catch {
    return null;
  }
};

export interface InstallNativeHostInput {
  cwd: string;
  extensionId: string;
  nativeHostName: string;
  browserChannel: BrowserChannel;
  hostCommand?: string;
  manifestDir?: string;
  launcherPath?: string;
  profileDir?: string;
}

export interface UninstallNativeHostInput {
  cwd: string;
  nativeHostName: string;
  browserChannel: BrowserChannel;
  manifestDir?: string;
  launcherPath?: string;
  profileDir?: string;
}

const resolveNativeHostRuntimeBundlePlan = async (input: {
  resolvedPaths: ReturnType<typeof resolveInstallPaths>;
  hostCommandSource: "explicit" | "repo_owned_default";
  hostCommand?: string;
}): Promise<{
  hostCommand: string;
  bundleRuntimeWritten: boolean;
}> => {
  if (input.hostCommandSource === "explicit") {
    return {
      hostCommand: input.hostCommand!.trim(),
      bundleRuntimeWritten: false
    };
  }

  const bundledEntryPath = await installBundledNativeHostRuntime(input.resolvedPaths.channelRoot);
  return {
    hostCommand: `${quoteShellToken(process.execPath)} ${quoteShellToken(bundledEntryPath)}`,
    bundleRuntimeWritten: true
  };
};

const listProfileScopedNativeHostManifestPaths = async (input: {
  profileRoot: string;
  profileDir?: string;
  nativeHostName: string;
}): Promise<string[]> => {
  if (input.profileDir) {
    return [join(input.profileDir, "NativeMessagingHosts", `${input.nativeHostName}.json`)];
  }

  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(input.profileRoot, { withFileTypes: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      join(input.profileRoot, entry.name, "NativeMessagingHosts", `${input.nativeHostName}.json`)
    );
};

const resolveProfileScopedNativeHostManifestCleanupPaths = async (input: {
  candidates: string[];
  launcherPath: string;
}): Promise<string[]> => {
  const removable: string[] = [];
  const expectedLauncherPath = normalizePathForBoundaryCheck(input.launcherPath);

  for (const candidate of input.candidates) {
    if (!(await pathExists(candidate))) {
      removable.push(candidate);
      continue;
    }

    const registration = await readNativeHostRegistrationManifest(candidate);
    if (
      registration?.launcherPath &&
      normalizePathForBoundaryCheck(registration.launcherPath) === expectedLauncherPath
    ) {
      removable.push(candidate);
    }
  }

  return removable;
};

export const installNativeHost = async (input: InstallNativeHostInput) => {
  const resolvedPaths = resolveInstallPaths({
    command: "runtime.install",
    cwd: input.cwd,
    nativeHostName: input.nativeHostName,
    browserChannel: input.browserChannel,
    manifestDir: input.manifestDir,
    launcherPath: input.launcherPath
  });
  const profileRoot = resolveProfileRoot(resolvedPaths.worktreePath);
  const allowedOrigin = `chrome-extension://${input.extensionId}/`;
  const profileDir = resolveProfileDirForLauncher({
    command: "runtime.install",
    cwd: resolvedPaths.worktreePath,
    profileRoot,
    profileDir: input.profileDir
  });
  await validateNativeHostInstallPaths({
    command: "runtime.install",
    resolvedPaths,
    profileRoot,
    profileDir
  });
  const currentRegistration = await readNativeHostRegistrationManifest(resolvedPaths.manifestPath);
  const previousManagedInstall =
    currentRegistration?.launcherPath && currentRegistration.launcherPath !== resolvedPaths.launcherPath
      ? inspectManagedNativeHostInstall(currentRegistration.launcherPath)
      : null;
  const previousLegacyLauncherPath =
    currentRegistration?.launcherPath &&
    currentRegistration.launcherPath !== resolvedPaths.launcherPath &&
    currentRegistration.launcherPath === resolveLegacyDefaultLauncherPath(resolvedPaths.manifestDir, input.nativeHostName)
      ? currentRegistration.launcherPath
      : null;
  const manifestExisted = await pathExists(resolvedPaths.manifestPath);
  const profileScopedManifestPath = profileDir
    ? join(profileDir, "NativeMessagingHosts", `${input.nativeHostName}.json`)
    : null;
  const profileScopedManifestExisted = profileScopedManifestPath
    ? await pathExists(profileScopedManifestPath)
    : false;
  if (profileScopedManifestPath && profileDir) {
    await assertNoSymlinkAncestorBetween({
      command: "runtime.install",
      field: "profile_dir",
      fromDir: profileDir,
      targetDir: dirname(profileScopedManifestPath)
    });
    await assertNotSymlink("runtime.install", "manifest_path", profileScopedManifestPath);
  }
  const launcherExisted = await pathExists(resolvedPaths.launcherPath);
  const bundleRuntimeExisted = await pathExists(join(resolvedPaths.runtimeRoot, "native-messaging", "native-host-entry.js"));
  await mkdir(resolvedPaths.manifestDir, { recursive: true });
  await mkdir(dirname(resolvedPaths.launcherPath), { recursive: true });
  const hostCommandSource =
    typeof input.hostCommand === "string" && input.hostCommand.trim().length > 0
      ? "explicit"
      : "repo_owned_default";
  const runtimeBundlePlan = await resolveNativeHostRuntimeBundlePlan({
    resolvedPaths,
    hostCommandSource,
    hostCommand: input.hostCommand
  });
  const hostCommand = runtimeBundlePlan.hostCommand;
  const bundleRuntimeWritten = runtimeBundlePlan.bundleRuntimeWritten;
  const usesExplicitProfileContract = hostCommandSource === "explicit" && !!profileDir;
  const nativeBridgeLauncherContract = usesExplicitProfileContract
    ? "dual_env_launcher_only"
    : "profile_root_only";
  const legacyProfileDir =
    usesExplicitProfileContract && profileDir
      ? resolveLegacyProfileDirForLauncher(profileRoot, profileDir)
      : undefined;
  const profileMode = usesExplicitProfileContract ? PROFILE_MODE_ROOT_PREFERRED : undefined;
  await writeFile(
    resolvedPaths.launcherPath,
    buildLauncherScript({
      command: "runtime.install",
      hostCommand,
      profileRoot,
      legacyProfileDir,
      profileMode
    }),
    "utf8"
  );
  await writeManagedInstallMetadata({
    channelRoot: resolvedPaths.channelRoot,
    profileRoot,
    bundleRuntimeExpected: bundleRuntimeWritten
  });
  await chmod(resolvedPaths.launcherPath, 0o755);

  const manifest = {
    name: input.nativeHostName,
    description: NATIVE_HOST_DESCRIPTION,
    path: resolvedPaths.launcherPath,
    type: "stdio",
    allowed_origins: [allowedOrigin]
  };
  await writeFile(resolvedPaths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (profileScopedManifestPath) {
    await mkdir(dirname(profileScopedManifestPath), { recursive: true });
    await writeFile(profileScopedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  if (
    previousManagedInstall &&
    normalizePathForBoundaryCheck(previousManagedInstall.channelRoot) !==
      normalizePathForBoundaryCheck(resolvedPaths.channelRoot)
  ) {
    await rm(previousManagedInstall.channelRoot, { recursive: true, force: true });
  }
  if (previousLegacyLauncherPath) {
    await rm(previousLegacyLauncherPath, { force: true });
  }

  return {
    operation: "install" as const,
    native_host_name: input.nativeHostName,
    browser_channel: input.browserChannel,
    extension_id: input.extensionId,
    install_scope: resolvedPaths.installScope,
    install_key: resolvedPaths.installKey,
    install_root: normalizePathForOutput(resolvedPaths.channelRoot),
    manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
    manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
    manifest_path_source: resolvedPaths.manifestPathSource,
    launcher_dir: normalizePathForOutput(dirname(resolvedPaths.launcherPath)),
    launcher_path: normalizePathForOutput(resolvedPaths.launcherPath),
    launcher_path_source: resolvedPaths.launcherPathSource,
    host_command: hostCommand,
    host_command_source: hostCommandSource,
    native_bridge_launcher_contract: nativeBridgeLauncherContract,
    profile_root: normalizePathForOutput(profileRoot),
    profile_dir: normalizePathForOutput(profileDir),
    profile_root_bridge_socket_path: normalizePathForOutput(
      resolveProfileScopedNativeBridgeSocketPath(profileRoot)
    ),
    profile_scoped_bridge_socket_path: normalizePathForOutput(
      profileDir ? resolveProfileScopedNativeBridgeSocketPath(profileDir) : null
    ),
    profile_scoped_manifest_path: normalizePathForOutput(profileScopedManifestPath),
    allowed_origins: [allowedOrigin],
    persistent_extension_identity: {
      extension_id: input.extensionId,
      native_host_name: input.nativeHostName,
      browser_channel: input.browserChannel,
      manifest_path: normalizePathForOutput(resolvedPaths.manifestPath)
    },
    existed_before: {
      manifest: manifestExisted,
      profile_scoped_manifest: profileScopedManifestExisted,
      launcher: launcherExisted,
      bundle_runtime: bundleRuntimeExisted
    },
    write_result: {
      manifest: manifestExisted ? "overwritten" : "created",
      profile_scoped_manifest: profileScopedManifestPath
        ? profileScopedManifestExisted
          ? "overwritten"
          : "created"
        : "not_applicable",
      launcher: launcherExisted ? "overwritten" : "created",
      bundle_runtime: bundleRuntimeWritten ? (bundleRuntimeExisted ? "overwritten" : "created") : "unchanged"
    },
    created: {
      manifest: true,
      profile_scoped_manifest: profileScopedManifestPath !== null,
      launcher: true,
      bundle_runtime: bundleRuntimeWritten
    }
  };
};

export const uninstallNativeHost = async (input: UninstallNativeHostInput) => {
  const resolvedPaths = resolveInstallPaths({
    command: "runtime.uninstall",
    cwd: input.cwd,
    nativeHostName: input.nativeHostName,
    browserChannel: input.browserChannel,
    manifestDir: input.manifestDir,
    launcherPath: input.launcherPath
  });
  const profileRoot = resolveProfileRoot(resolvedPaths.worktreePath);
  const profileDir = resolveProfileDirForLauncher({
    command: "runtime.uninstall",
    cwd: resolvedPaths.worktreePath,
    profileRoot,
    profileDir: input.profileDir
  });
  await assertNoSymlinkAncestorBetween({
    command: "runtime.uninstall",
    field: "manifest_dir",
    fromDir: resolvedPaths.manifestRoot,
    targetDir: resolvedPaths.manifestDir
  });
  await assertNotSymlink("runtime.uninstall", "manifest_path", resolvedPaths.manifestPath);
  const currentRegistration = await readNativeHostRegistrationManifest(resolvedPaths.manifestPath);
  const legacyLauncherPath = resolvedPaths.hasCustomLauncherPath
    ? null
    : resolveLegacyDefaultLauncherPath(resolvedPaths.manifestDir, input.nativeHostName);
  const registeredLauncherPath = currentRegistration?.launcherPath ?? null;
  const registeredManagedInstall = registeredLauncherPath
    ? inspectManagedNativeHostInstall(registeredLauncherPath)
    : null;
  const shouldDeleteExplicitLauncher = resolvedPaths.hasCustomLauncherPath;
  const shouldDeleteRegisteredLegacyLauncher =
    !resolvedPaths.hasCustomLauncherPath &&
    registeredLauncherPath !== null &&
    legacyLauncherPath !== null &&
    registeredLauncherPath === legacyLauncherPath;
  const shouldDeleteRegisteredManagedLauncher =
    !resolvedPaths.hasCustomLauncherPath && registeredManagedInstall !== null;
  const launcherPath =
    shouldDeleteExplicitLauncher || !registeredLauncherPath ? resolvedPaths.launcherPath : registeredLauncherPath;
  const managedInstall = shouldDeleteRegisteredManagedLauncher ? registeredManagedInstall : null;
  const managedInstallMetadata = managedInstall
    ? await readManagedInstallMetadata(managedInstall.channelRoot)
    : null;
  const profileRootForCleanup =
    !profileDir && managedInstallMetadata?.profile_root
      ? managedInstallMetadata.profile_root
      : profileRoot;
  const launcherPathSource = resolvedPaths.hasCustomLauncherPath
    ? ("custom" as InstallPathSource)
    : managedInstall
      ? ("repo_owned_default" as InstallPathSource)
      : ("browser_default" as InstallPathSource);
  if (shouldDeleteExplicitLauncher || managedInstall) {
    await assertNoSymlinkAncestorBetween({
      command: "runtime.uninstall",
      field: "launcher_path",
      fromDir: managedInstall?.launcherRoot ?? resolvedPaths.launcherRoot,
      targetDir: dirname(launcherPath)
    });
    await assertNotSymlink("runtime.uninstall", "launcher_path", launcherPath);
  }
  if (legacyLauncherPath && legacyLauncherPath !== launcherPath) {
    await assertNotSymlink("runtime.uninstall", "launcher_path", legacyLauncherPath);
  }
  const manifestExisted = await pathExists(resolvedPaths.manifestPath);
  const profileScopedManifestPaths = await listProfileScopedNativeHostManifestPaths({
    profileRoot: profileRootForCleanup,
    profileDir,
    nativeHostName: input.nativeHostName
  });
  const removableProfileScopedManifestPaths = await resolveProfileScopedNativeHostManifestCleanupPaths({
    candidates: profileScopedManifestPaths,
    launcherPath
  });
  for (const profileScopedManifestPath of removableProfileScopedManifestPaths) {
    const scopedProfileDir = dirname(dirname(profileScopedManifestPath));
    await assertNoSymlinkAncestorBetween({
      command: "runtime.uninstall",
      field: "profile_dir",
      fromDir: profileRootForCleanup,
      targetDir: scopedProfileDir
    });
    await assertNoSymlinkAncestorBetween({
      command: "runtime.uninstall",
      field: "profile_dir",
      fromDir: scopedProfileDir,
      targetDir: dirname(profileScopedManifestPath)
    });
    await assertNotSymlink("runtime.uninstall", "manifest_path", profileScopedManifestPath);
  }
  const profileScopedManifestExistingPaths: string[] = [];
  for (const profileScopedManifestPath of removableProfileScopedManifestPaths) {
    if (await pathExists(profileScopedManifestPath)) {
      profileScopedManifestExistingPaths.push(profileScopedManifestPath);
    }
  }
  const launcherExisted =
    shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
      ? await pathExists(launcherPath)
      : false;
  const bundleRuntimeExisted = managedInstall ? await pathExists(managedInstall.runtimeRoot) : false;
  const legacyLauncherExisted =
    legacyLauncherPath && legacyLauncherPath !== launcherPath
      ? await pathExists(legacyLauncherPath)
      : false;
  await rm(resolvedPaths.manifestPath, { force: true });
  for (const profileScopedManifestPath of removableProfileScopedManifestPaths) {
    await rm(profileScopedManifestPath, { force: true });
  }
  if (managedInstall) {
    await rm(managedInstall.channelRoot, { recursive: true, force: true });
  } else if (shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher) {
    await rm(launcherPath, { force: true });
  }
  if (legacyLauncherPath && legacyLauncherPath !== launcherPath) {
    await rm(legacyLauncherPath, { force: true });
  }

  return {
    operation: "uninstall" as const,
    native_host_name: input.nativeHostName,
    browser_channel: input.browserChannel,
    install_scope: managedInstall?.installScope ?? resolvedPaths.installScope,
    install_key: managedInstall?.installKey ?? resolvedPaths.installKey,
    install_root: normalizePathForOutput(managedInstall?.channelRoot ?? resolvedPaths.channelRoot),
    manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
    manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
    manifest_path_source: resolvedPaths.manifestPathSource,
    profile_dir: normalizePathForOutput(profileDir),
    profile_scoped_manifest_path:
      profileDir && removableProfileScopedManifestPaths.length > 0
        ? normalizePathForOutput(removableProfileScopedManifestPaths[0])
        : null,
    profile_scoped_manifest_paths: removableProfileScopedManifestPaths.map((entry) =>
      normalizePathForOutput(entry)
    ),
    launcher_dir: normalizePathForOutput(dirname(launcherPath)),
    launcher_path: normalizePathForOutput(launcherPath),
    launcher_path_source: launcherPathSource,
    legacy_launcher_path: normalizePathForOutput(
      legacyLauncherPath && legacyLauncherPath !== launcherPath ? legacyLauncherPath : null
    ),
    removed: {
      manifest: manifestExisted,
      profile_scoped_manifest: profileScopedManifestExistingPaths.length > 0,
      profile_scoped_manifest_count: profileScopedManifestExistingPaths.length,
      launcher: launcherExisted,
      bundle_runtime: bundleRuntimeExisted,
      legacy_launcher: legacyLauncherExisted
    },
    remove_result: {
      manifest: manifestExisted ? "removed" : "already_absent",
      profile_scoped_manifest: removableProfileScopedManifestPaths.length > 0
        ? profileScopedManifestExistingPaths.length > 0
          ? "removed"
          : "already_absent"
        : "not_applicable",
      launcher:
        shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
          ? launcherExisted
            ? "removed"
            : "already_absent"
          : "preserved_non_managed",
      bundle_runtime: bundleRuntimeExisted ? "removed" : "already_absent",
      legacy_launcher: legacyLauncherExisted ? "removed" : "already_absent"
    },
    idempotent:
      !manifestExisted &&
      profileScopedManifestExistingPaths.length === 0 &&
      !launcherExisted &&
      !bundleRuntimeExisted &&
      !legacyLauncherExisted
  };
};
