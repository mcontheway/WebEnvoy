import { access, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CliError } from "../core/errors.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "../runtime/native-messaging/host.js";
import { resolveManifestDiscoveryDirectory } from "./native-host-platform.js";
import { resolveNativeHostInstallRoots } from "./native-host-install-root.js";
const asAbsolutePath = (cwd, input) => isAbsolute(input) ? input : resolve(cwd, input);
export const nativeHostPathError = (abilityId, reason, details) => new CliError("ERR_CLI_INVALID_ARGS", "安装命令参数不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason,
        ...details
    }
});
export const pathExists = async (filePath) => {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
};
export const assertNotSymlink = async (command, field, targetPath) => {
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
export const assertNoSymlinkAncestorBetween = async (input) => {
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
export const resolveProfileRoot = (cwd) => resolve(cwd, ".webenvoy", "profiles");
export const resolveProfileScopedNativeBridgeSocketPath = (profileDir) => join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME);
export const resolveControlledInstallRoots = (cwd, browserChannel) => resolveNativeHostInstallRoots(cwd, browserChannel);
export const resolveRepoOwnedManifestPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).manifestRoot, `${nativeHostName}.json`);
export const resolveRepoOwnedLauncherPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).launcherRoot, `${nativeHostName}-launcher`);
export const resolveLegacyDefaultLauncherPath = (manifestDir, nativeHostName) => join(manifestDir, `${nativeHostName}-launcher`);
export const normalizePathForBoundaryCheck = (input) => {
    const normalized = resolve(input);
    return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized;
};
const isPathInside = (baseDir, targetPath) => {
    const normalizedBase = normalizePathForBoundaryCheck(baseDir);
    const normalizedTarget = normalizePathForBoundaryCheck(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
export const normalizePathForOutput = (input) => typeof input === "string" ? normalizePathForBoundaryCheck(input) : null;
const canonicalizeProfileDirForLauncher = (profileRoot, profileDir) => {
    const normalizedRoot = normalizePathForBoundaryCheck(profileRoot);
    const normalizedProfileDir = normalizePathForBoundaryCheck(profileDir);
    const profileKey = relative(normalizedRoot, normalizedProfileDir);
    return profileKey.length > 0 ? resolve(profileRoot, profileKey) : resolve(profileRoot);
};
export const resolveInstallPaths = (input) => {
    const roots = resolveControlledInstallRoots(input.cwd, input.browserChannel);
    const platform = input.platform ?? process.platform;
    const hasCustomManifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0;
    const manifestDiscoveryRoot = platform === "win32"
        ? roots.manifestRoot
        : resolveManifestDiscoveryDirectory(input.browserChannel, platform);
    const manifestDir = hasCustomManifestDir
        ? asAbsolutePath(input.cwd, input.manifestDir)
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
            ? "custom"
            : platform === "win32"
                ? "repo_owned_default"
                : "browser_default",
        launcherPathSource: hasCustomLauncherPath ? "custom" : "repo_owned_default"
    };
};
export const resolveProfileDirForLauncher = (input) => {
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
export const resolveLegacyProfileDirForLauncher = (profileRoot, profileDir) => canonicalizeProfileDirForLauncher(profileRoot, profileDir);
export const validateNativeHostInstallPaths = async (input) => {
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
