import { access, chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "../core/errors.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "../runtime/native-messaging/host.js";
export const DEFAULT_NATIVE_HOST_NAME = "com.webenvoy.host";
export const DEFAULT_BROWSER_CHANNEL = "chrome";
const NATIVE_HOST_DESCRIPTION = "WebEnvoy CLI ↔ Extension bridge";
const BROWSER_CHANNELS = ["chrome", "chrome_beta", "chromium", "brave", "edge"];
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const NATIVE_HOST_NAME_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const asAbsolutePath = (cwd, input) => isAbsolute(input) ? input : resolve(cwd, input);
const nativeHostPathError = (abilityId, reason, details) => new CliError("ERR_CLI_INVALID_ARGS", "安装命令参数不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason,
        ...details
    }
});
const pathExists = async (filePath) => {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
};
const assertNotSymlink = async (command, field, targetPath) => {
    try {
        const stat = await lstat(targetPath);
        if (!stat.isSymbolicLink()) {
            return;
        }
    }
    catch (error) {
        const nodeError = error;
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
const assertNoSymlinkAncestorBetween = async (input) => {
    const normalizedFrom = normalizePathForBoundaryCheck(input.fromDir);
    const normalizedTarget = normalizePathForBoundaryCheck(input.targetDir);
    const rel = relative(normalizedFrom, normalizedTarget);
    const isInside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    if (!isInside) {
        return;
    }
    const segments = rel === "" ? [] : rel.split(sep).filter((segment) => segment.length > 0 && segment !== ".");
    let current = normalizedFrom;
    try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) {
            throw nativeHostPathError(input.command, "INSTALL_PATH_PARENT_SYMBOLIC_LINK", {
                field: input.field,
                received_path: current
            });
        }
    }
    catch (error) {
        const nodeError = error;
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
        }
        catch (error) {
            const nodeError = error;
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
export const resolveRepoOwnedNativeHostEntryPath = () => fileURLToPath(new URL("../runtime/native-messaging/native-host-entry.js", import.meta.url));
export const resolveRepoOwnedNativeHostCommand = () => `${quoteShellToken(process.execPath)} ${quoteShellToken(resolveRepoOwnedNativeHostEntryPath())}`;
export const resolveProfileRoot = (cwd) => resolve(cwd, ".webenvoy", "profiles");
export const resolveProfileScopedNativeBridgeSocketPath = (profileDir) => join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME);
export const isBrowserChannel = (value) => BROWSER_CHANNELS.includes(value);
export const isValidExtensionId = (value) => EXTENSION_ID_PATTERN.test(value);
export const isValidNativeHostName = (value) => NATIVE_HOST_NAME_PATTERN.test(value);
const resolveDefaultManifestDirectory = (browserChannel) => {
    if (process.platform === "darwin") {
        const baseByChannel = {
            chrome: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
            chrome_beta: join(homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
            chromium: join(homedir(), "Library", "Application Support", "Chromium"),
            brave: join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), "Library", "Application Support", "Microsoft Edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts");
    }
    if (process.platform === "linux") {
        const baseByChannel = {
            chrome: join(homedir(), ".config", "google-chrome"),
            chrome_beta: join(homedir(), ".config", "google-chrome-beta"),
            chromium: join(homedir(), ".config", "chromium"),
            brave: join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), ".config", "microsoft-edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts");
    }
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "runtime.install 当前仅支持 darwin/linux", {
        retryable: false
    });
};
const resolveManifestDirectoryOverride = () => {
    const override = process.env.WEBENVOY_NATIVE_HOST_MANIFEST_DIR;
    if (typeof override !== "string" || override.trim().length === 0) {
        return null;
    }
    return resolve(override.trim());
};
export const resolveManifestDiscoveryDirectory = (browserChannel) => resolveManifestDirectoryOverride() ?? resolveDefaultManifestDirectory(browserChannel);
const buildLauncherScript = (input) => {
    const argv = tokenizeHostCommand(input.command, input.hostCommand)
        .map((token) => quoteShellArgForScript(token))
        .join(" ");
    const profileRootExport = typeof input.profileRoot === "string" && input.profileRoot.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT=${quoteShellArgForScript(input.profileRoot)}\n`
        : "";
    return `#!/usr/bin/env bash
set -euo pipefail
${profileRootExport}exec ${argv} "$@"
`;
};
export const resolveControlledInstallRoots = (cwd, browserChannel) => {
    const channelRoot = resolve(cwd, ".webenvoy", "native-host-install", browserChannel);
    return {
        channelRoot,
        manifestRoot: join(channelRoot, "manifests"),
        launcherRoot: join(channelRoot, "bin")
    };
};
export const resolveRepoOwnedManifestPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).manifestRoot, `${nativeHostName}.json`);
export const resolveRepoOwnedLauncherPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).launcherRoot, `${nativeHostName}-launcher`);
const normalizePathForBoundaryCheck = (input) => {
    const normalized = resolve(input);
    return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized;
};
const isPathInside = (baseDir, targetPath) => {
    const normalizedBase = normalizePathForBoundaryCheck(baseDir);
    const normalizedTarget = normalizePathForBoundaryCheck(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    return (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)));
};
const normalizePathForOutput = (input) => typeof input === "string" ? normalizePathForBoundaryCheck(input) : null;
const resolveInstallPaths = (input) => {
    const roots = resolveControlledInstallRoots(input.cwd, input.browserChannel);
    const manifestRoot = resolveManifestDiscoveryDirectory(input.browserChannel);
    const manifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0
        ? asAbsolutePath(input.cwd, input.manifestDir)
        : manifestRoot;
    const hasCustomManifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0;
    if (hasCustomManifestDir && !isPathInside(manifestRoot, manifestDir)) {
        throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
            field: "manifest_dir",
            allowed_root: manifestRoot,
            received_path: manifestDir
        });
    }
    const manifestPath = join(manifestDir, `${input.nativeHostName}.json`);
    const launcherPath = typeof input.launcherPath === "string" && input.launcherPath.length > 0
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
        channelRoot: roots.channelRoot,
        manifestRoot,
        manifestDir,
        manifestPath,
        launcherPath,
        hasCustomManifestDir,
        hasCustomLauncherPath,
        manifestPathSource: hasCustomManifestDir ? "custom" : "browser_default",
        launcherPathSource: hasCustomLauncherPath ? "custom" : "repo_owned_default"
    };
};
const resolveProfileDirForLauncher = (input) => {
    if (typeof input.profileDir !== "string" || input.profileDir.trim().length === 0) {
        return undefined;
    }
    const normalizedProfileDir = asAbsolutePath(input.cwd, input.profileDir.trim());
    const profileRoot = resolveProfileRoot(input.cwd);
    if (!isPathInside(profileRoot, normalizedProfileDir)) {
        throw nativeHostPathError("runtime.install", "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
            field: "profile_dir",
            allowed_root: profileRoot,
            received_path: normalizedProfileDir
        });
    }
    return normalizedProfileDir;
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
    const allowedOrigin = `chrome-extension://${input.extensionId}/`;
    const hostCommand = typeof input.hostCommand === "string" && input.hostCommand.trim().length > 0
        ? input.hostCommand.trim()
        : resolveRepoOwnedNativeHostCommand();
    const hostCommandSource = typeof input.hostCommand === "string" && input.hostCommand.trim().length > 0
        ? "explicit"
        : "repo_owned_default";
    const profileDir = resolveProfileDirForLauncher({
        cwd: input.cwd,
        profileDir: input.profileDir
    });
    await assertNoSymlinkAncestorBetween({
        command: "runtime.install",
        field: "manifest_dir",
        fromDir: resolvedPaths.manifestRoot,
        targetDir: resolvedPaths.manifestDir
    });
    if (resolvedPaths.hasCustomLauncherPath) {
        await assertNoSymlinkAncestorBetween({
            command: "runtime.install",
            field: "launcher_path",
            fromDir: input.cwd,
            targetDir: dirname(resolvedPaths.launcherPath)
        });
    }
    if (profileDir) {
        await assertNoSymlinkAncestorBetween({
            command: "runtime.install",
            field: "profile_dir",
            fromDir: resolveProfileRoot(input.cwd),
            targetDir: profileDir
        });
    }
    const manifestExisted = await pathExists(resolvedPaths.manifestPath);
    const launcherExisted = await pathExists(resolvedPaths.launcherPath);
    await mkdir(resolvedPaths.manifestDir, { recursive: true });
    await mkdir(dirname(resolvedPaths.launcherPath), { recursive: true });
    await assertNotSymlink("runtime.install", "launcher_path", resolvedPaths.launcherPath);
    await assertNotSymlink("runtime.install", "manifest_path", resolvedPaths.manifestPath);
    await writeFile(resolvedPaths.launcherPath, buildLauncherScript({
        command: "runtime.install",
        hostCommand,
        profileRoot: profileDir ? resolveProfileRoot(input.cwd) : undefined
    }), "utf8");
    await chmod(resolvedPaths.launcherPath, 0o755);
    const manifest = {
        name: input.nativeHostName,
        description: NATIVE_HOST_DESCRIPTION,
        path: resolvedPaths.launcherPath,
        type: "stdio",
        allowed_origins: [allowedOrigin]
    };
    await writeFile(resolvedPaths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return {
        operation: "install",
        native_host_name: input.nativeHostName,
        browser_channel: input.browserChannel,
        extension_id: input.extensionId,
        install_root: normalizePathForOutput(resolvedPaths.channelRoot),
        manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
        manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
        manifest_path_source: resolvedPaths.manifestPathSource,
        launcher_dir: normalizePathForOutput(dirname(resolvedPaths.launcherPath)),
        launcher_path: normalizePathForOutput(resolvedPaths.launcherPath),
        launcher_path_source: resolvedPaths.launcherPathSource,
        host_command: hostCommand,
        host_command_source: hostCommandSource,
        profile_dir: normalizePathForOutput(profileDir),
        profile_scoped_bridge_socket_path: normalizePathForOutput(profileDir ? resolveProfileScopedNativeBridgeSocketPath(profileDir) : null),
        allowed_origins: [allowedOrigin],
        persistent_extension_identity: {
            extension_id: input.extensionId,
            native_host_name: input.nativeHostName,
            browser_channel: input.browserChannel,
            manifest_path: normalizePathForOutput(resolvedPaths.manifestPath)
        },
        existed_before: {
            manifest: manifestExisted,
            launcher: launcherExisted
        },
        write_result: {
            manifest: manifestExisted ? "overwritten" : "created",
            launcher: launcherExisted ? "overwritten" : "created"
        },
        created: {
            manifest: true,
            launcher: true
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
    if (resolvedPaths.hasCustomLauncherPath) {
        await assertNoSymlinkAncestorBetween({
            command: "runtime.uninstall",
            field: "launcher_path",
            fromDir: input.cwd,
            targetDir: dirname(resolvedPaths.launcherPath)
        });
    }
    await assertNotSymlink("runtime.uninstall", "manifest_path", resolvedPaths.manifestPath);
    await assertNotSymlink("runtime.uninstall", "launcher_path", resolvedPaths.launcherPath);
    const manifestExisted = await pathExists(resolvedPaths.manifestPath);
    const launcherExisted = await pathExists(resolvedPaths.launcherPath);
    await rm(resolvedPaths.manifestPath, { force: true });
    await rm(resolvedPaths.launcherPath, { force: true });
    return {
        operation: "uninstall",
        native_host_name: input.nativeHostName,
        browser_channel: input.browserChannel,
        install_root: normalizePathForOutput(resolvedPaths.channelRoot),
        manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
        manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
        manifest_path_source: resolvedPaths.manifestPathSource,
        launcher_dir: normalizePathForOutput(dirname(resolvedPaths.launcherPath)),
        launcher_path: normalizePathForOutput(resolvedPaths.launcherPath),
        launcher_path_source: resolvedPaths.launcherPathSource,
        removed: {
            manifest: manifestExisted,
            launcher: launcherExisted
        },
        remove_result: {
            manifest: manifestExisted ? "removed" : "already_absent",
            launcher: launcherExisted ? "removed" : "already_absent"
        },
        idempotent: !manifestExisted && !launcherExisted
    };
};
