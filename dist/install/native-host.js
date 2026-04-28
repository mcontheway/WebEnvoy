import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectManagedNativeHostInstall } from "./native-host-install-root.js";
import { assertNoSymlinkAncestorBetween, assertNotSymlink, nativeHostPathError, normalizePathForBoundaryCheck, normalizePathForOutput, pathExists, resolveInstallPaths, resolveLegacyDefaultLauncherPath, resolveLegacyProfileDirForLauncher, resolveProfileDirForLauncher, resolveProfileRoot, resolveProfileScopedNativeBridgeSocketPath, validateNativeHostInstallPaths } from "./native-host-paths.js";
export { DEFAULT_BROWSER_CHANNEL, DEFAULT_NATIVE_HOST_NAME, isBrowserChannel, isValidExtensionId, isValidNativeHostName } from "./native-host-platform.js";
const NATIVE_HOST_DESCRIPTION = "WebEnvoy CLI ↔ Extension bridge";
const MANAGED_INSTALL_METADATA_FILENAME = "install-metadata.json";
const quoteShellToken = (value) => JSON.stringify(value);
const quoteShellArgForScript = (value) => `'${value.replace(/'/g, `'\"'\"'`)}'`;
const tokenizeHostCommand = (command, hostCommand) => {
    const tokens = [];
    let current = "";
    let index = 0;
    let quote = null;
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
const resolveBundledNativeHostRuntimePaths = (channelRoot) => {
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
const installBundledNativeHostRuntime = async (channelRoot) => {
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
export const resolveRepoOwnedNativeHostEntryPath = () => resolveCurrentBuildNativeHostRuntimePaths().entryPath;
const PROFILE_MODE_ROOT_PREFERRED = "profile_root_preferred";
export const resolveRepoOwnedNativeHostCommand = () => `${quoteShellToken(process.execPath)} ${quoteShellToken(resolveRepoOwnedNativeHostEntryPath())}`;
const readNativeHostRegistrationManifest = async (manifestPath) => {
    try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        const launcherPath = typeof parsed.path === "string" && parsed.path.trim().length > 0
            ? (isAbsolute(parsed.path) ? parsed.path : resolve(dirname(manifestPath), parsed.path))
            : null;
        return {
            name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : null,
            launcherPath,
            allowedOrigins: Array.isArray(parsed.allowed_origins)
                ? parsed.allowed_origins.filter((entry) => typeof entry === "string")
                : []
        };
    }
    catch {
        return null;
    }
};
const buildLauncherScript = (input) => {
    const argv = tokenizeHostCommand(input.command, input.hostCommand)
        .map((token) => quoteShellArgForScript(token))
        .join(" ");
    const profileRootExport = typeof input.profileRoot === "string" && input.profileRoot.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT=${quoteShellArgForScript(input.profileRoot)}\n`
        : "";
    const legacyProfileDirExport = typeof input.legacyProfileDir === "string" && input.legacyProfileDir.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR=${quoteShellArgForScript(input.legacyProfileDir)}\n`
        : "";
    const profileModeExport = typeof input.profileMode === "string" && input.profileMode.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE=${quoteShellArgForScript(input.profileMode)}\n`
        : "";
    return `#!/usr/bin/env bash
set -euo pipefail
${profileRootExport}${legacyProfileDirExport}${profileModeExport}exec ${argv} "$@"
`;
};
const writeManagedInstallMetadata = async (input) => {
    const metadata = {
        profile_root: input.profileRoot,
        bundle_runtime_expected: input.bundleRuntimeExpected
    };
    await writeFile(join(input.channelRoot, MANAGED_INSTALL_METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};
const resolveNativeHostRuntimeBundlePlan = async (input) => {
    if (input.hostCommandSource === "explicit") {
        return {
            hostCommand: input.hostCommand.trim(),
            bundleRuntimeWritten: false
        };
    }
    const bundledEntryPath = await installBundledNativeHostRuntime(input.resolvedPaths.channelRoot);
    return {
        hostCommand: `${quoteShellToken(process.execPath)} ${quoteShellToken(bundledEntryPath)}`,
        bundleRuntimeWritten: true
    };
};
export const installNativeHost = async (input) => {
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
    const previousManagedInstall = currentRegistration?.launcherPath && currentRegistration.launcherPath !== resolvedPaths.launcherPath
        ? inspectManagedNativeHostInstall(currentRegistration.launcherPath)
        : null;
    const previousLegacyLauncherPath = currentRegistration?.launcherPath &&
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
    const launcherExisted = await pathExists(resolvedPaths.launcherPath);
    const bundleRuntimeExisted = await pathExists(join(resolvedPaths.runtimeRoot, "native-messaging", "native-host-entry.js"));
    await mkdir(resolvedPaths.manifestDir, { recursive: true });
    await mkdir(dirname(resolvedPaths.launcherPath), { recursive: true });
    const hostCommandSource = typeof input.hostCommand === "string" && input.hostCommand.trim().length > 0
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
    const legacyProfileDir = usesExplicitProfileContract && profileDir
        ? resolveLegacyProfileDirForLauncher(profileRoot, profileDir)
        : undefined;
    const profileMode = usesExplicitProfileContract ? PROFILE_MODE_ROOT_PREFERRED : undefined;
    await writeFile(resolvedPaths.launcherPath, buildLauncherScript({
        command: "runtime.install",
        hostCommand,
        profileRoot,
        legacyProfileDir,
        profileMode
    }), "utf8");
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
    if (previousManagedInstall &&
        normalizePathForBoundaryCheck(previousManagedInstall.channelRoot) !==
            normalizePathForBoundaryCheck(resolvedPaths.channelRoot)) {
        await rm(previousManagedInstall.channelRoot, { recursive: true, force: true });
    }
    if (previousLegacyLauncherPath) {
        await rm(previousLegacyLauncherPath, { force: true });
    }
    return {
        operation: "install",
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
        profile_root_bridge_socket_path: normalizePathForOutput(resolveProfileScopedNativeBridgeSocketPath(profileRoot)),
        profile_scoped_bridge_socket_path: normalizePathForOutput(profileDir ? resolveProfileScopedNativeBridgeSocketPath(profileDir) : null),
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
export const uninstallNativeHost = async (input) => {
    const resolvedPaths = resolveInstallPaths({
        command: "runtime.uninstall",
        cwd: input.cwd,
        nativeHostName: input.nativeHostName,
        browserChannel: input.browserChannel,
        manifestDir: input.manifestDir,
        launcherPath: input.launcherPath
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
    const shouldDeleteRegisteredLegacyLauncher = !resolvedPaths.hasCustomLauncherPath &&
        registeredLauncherPath !== null &&
        legacyLauncherPath !== null &&
        registeredLauncherPath === legacyLauncherPath;
    const shouldDeleteRegisteredManagedLauncher = !resolvedPaths.hasCustomLauncherPath && registeredManagedInstall !== null;
    const launcherPath = shouldDeleteExplicitLauncher || !registeredLauncherPath ? resolvedPaths.launcherPath : registeredLauncherPath;
    const managedInstall = shouldDeleteRegisteredManagedLauncher ? registeredManagedInstall : null;
    const launcherPathSource = resolvedPaths.hasCustomLauncherPath
        ? "custom"
        : managedInstall
            ? "repo_owned_default"
            : "browser_default";
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
    const launcherExisted = shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
        ? await pathExists(launcherPath)
        : false;
    const bundleRuntimeExisted = managedInstall ? await pathExists(managedInstall.runtimeRoot) : false;
    const legacyLauncherExisted = legacyLauncherPath && legacyLauncherPath !== launcherPath
        ? await pathExists(legacyLauncherPath)
        : false;
    await rm(resolvedPaths.manifestPath, { force: true });
    if (managedInstall) {
        await rm(managedInstall.channelRoot, { recursive: true, force: true });
    }
    else if (shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher) {
        await rm(launcherPath, { force: true });
    }
    if (legacyLauncherPath && legacyLauncherPath !== launcherPath) {
        await rm(legacyLauncherPath, { force: true });
    }
    return {
        operation: "uninstall",
        native_host_name: input.nativeHostName,
        browser_channel: input.browserChannel,
        install_scope: managedInstall?.installScope ?? resolvedPaths.installScope,
        install_key: managedInstall?.installKey ?? resolvedPaths.installKey,
        install_root: normalizePathForOutput(managedInstall?.channelRoot ?? resolvedPaths.channelRoot),
        manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
        manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
        manifest_path_source: resolvedPaths.manifestPathSource,
        launcher_dir: normalizePathForOutput(dirname(launcherPath)),
        launcher_path: normalizePathForOutput(launcherPath),
        launcher_path_source: launcherPathSource,
        legacy_launcher_path: normalizePathForOutput(legacyLauncherPath && legacyLauncherPath !== launcherPath ? legacyLauncherPath : null),
        removed: {
            manifest: manifestExisted,
            launcher: launcherExisted,
            bundle_runtime: bundleRuntimeExisted,
            legacy_launcher: legacyLauncherExisted
        },
        remove_result: {
            manifest: manifestExisted ? "removed" : "already_absent",
            launcher: shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
                ? launcherExisted
                    ? "removed"
                    : "already_absent"
                : "preserved_non_managed",
            bundle_runtime: bundleRuntimeExisted ? "removed" : "already_absent",
            legacy_launcher: legacyLauncherExisted ? "removed" : "already_absent"
        },
        idempotent: !manifestExisted && !launcherExisted && !bundleRuntimeExisted && !legacyLauncherExisted
    };
};
