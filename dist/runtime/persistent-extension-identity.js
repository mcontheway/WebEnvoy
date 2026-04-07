import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { CliError } from "../core/errors.js";
import { DEFAULT_NATIVE_HOST_NAME, isBrowserChannel, isValidNativeHostName, EXTENSION_ID_PATTERN } from "../install/native-host-platform.js";
import { BrowserLaunchError, isUnsupportedBrandedChromeForExtensions, resolvePreferredBrowserVersionTruthSource } from "./browser-launcher.js";
import { readNativeHostManifest, resolveInstallDiagnostics, resolveManifestPathForBinding, resolveProfileExtensionState } from "./persistent-extension-identity-install.js";
const execFileAsync = promisify(execFile);
const DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS = {
    resolvePreferredBrowserVersionTruthSource,
    isUnsupportedBrandedChromeForExtensions,
    execFile: execFileAsync,
    platform: () => process.platform
};
let identityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
const EMPTY_INSTALL_DIAGNOSTICS = {
    launcherPath: null,
    launcherExists: null,
    launcherExecutable: null,
    bundleRuntimePath: null,
    bundleRuntimeExists: null,
    launcherProfileRoot: null,
    expectedProfileRoot: null,
    profileRootMatches: null,
    legacyLauncherDetected: null
};
export const setIdentityPreflightAdaptersForTests = (overrides) => {
    identityPreflightAdapters = {
        ...DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS,
        ...overrides
    };
};
export const resetIdentityPreflightAdaptersForTests = () => {
    identityPreflightAdapters = DEFAULT_IDENTITY_PREFLIGHT_ADAPTERS;
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const ensureValidNativeHostName = (nativeHostName) => {
    if (!isValidNativeHostName(nativeHostName)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.native_host_name 格式非法，必须满足 Chrome Native Messaging host 命名规则", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
            }
        });
    }
};
const inferResolvedBrowserChannel = (input) => {
    const normalizedVersion = input.browserVersion?.trim().toLowerCase() ?? "";
    const normalizedPath = input.browserPath?.toLowerCase() ?? "";
    if (normalizedVersion.includes("google chrome beta") || normalizedPath.includes("chrome beta")) {
        return "chrome_beta";
    }
    if (normalizedVersion.includes("google chrome")) {
        return "chrome";
    }
    if (normalizedVersion.includes("chromium") || normalizedPath.includes("chromium")) {
        return "chromium";
    }
    if (normalizedVersion.includes("microsoft edge") || normalizedPath.includes("microsoft/edge")) {
        return "edge";
    }
    if (normalizedVersion.includes("brave") || normalizedPath.includes("brave")) {
        return "brave";
    }
    return null;
};
const parsePersistentExtensionBindingFromParams = (params) => {
    const raw = asRecord(params.persistent_extension_identity) ??
        asRecord(params.persistentExtensionIdentity);
    if (!raw) {
        return null;
    }
    const extensionId = asNonEmptyString(raw.extension_id) ?? asNonEmptyString(raw.extensionId);
    if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.extension_id 必须是 32 位 Chrome extension id", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_EXTENSION_ID"
            }
        });
    }
    const nativeHostName = asNonEmptyString(raw.native_host_name) ??
        asNonEmptyString(raw.nativeHostName) ??
        DEFAULT_NATIVE_HOST_NAME;
    ensureValidNativeHostName(nativeHostName);
    const browserChannelRaw = asNonEmptyString(raw.browser_channel) ?? asNonEmptyString(raw.browserChannel) ?? "chrome";
    if (!isBrowserChannel(browserChannelRaw)) {
        throw new CliError("ERR_PROFILE_INVALID", "persistent_extension_identity.browser_channel 不受支持", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_BROWSER_CHANNEL"
            }
        });
    }
    const manifestPathRaw = asNonEmptyString(raw.manifest_path) ??
        asNonEmptyString(raw.manifestPath) ??
        asNonEmptyString(process.env.WEBENVOY_NATIVE_HOST_MANIFEST_PATH) ??
        null;
    const manifestPath = manifestPathRaw === null
        ? null
        : isAbsolute(manifestPathRaw)
            ? manifestPathRaw
            : resolve(manifestPathRaw);
    return {
        extensionId,
        nativeHostName,
        browserChannel: browserChannelRaw,
        manifestPath
    };
};
const parsePersistentExtensionBindingFromMeta = (meta) => {
    const raw = meta?.persistentExtensionBinding;
    if (!raw) {
        return null;
    }
    if (typeof raw.extensionId !== "string" ||
        !EXTENSION_ID_PATTERN.test(raw.extensionId) ||
        typeof raw.browserChannel !== "string" ||
        !isBrowserChannel(raw.browserChannel)) {
        return null;
    }
    if (typeof raw.nativeHostName !== "string") {
        return null;
    }
    const nativeHostName = raw.nativeHostName.trim();
    if (nativeHostName.length === 0) {
        return null;
    }
    if (!isValidNativeHostName(nativeHostName)) {
        throw new CliError("ERR_PROFILE_INVALID", "profile meta 中的 persistentExtensionBinding.nativeHostName 格式非法", {
            details: {
                ability_id: "runtime.identity_preflight",
                stage: "input_validation",
                reason: "IDENTITY_BINDING_INVALID_NATIVE_HOST_NAME"
            }
        });
    }
    if (raw.manifestPath !== null && typeof raw.manifestPath !== "string") {
        return null;
    }
    return {
        extensionId: raw.extensionId,
        nativeHostName,
        browserChannel: raw.browserChannel,
        manifestPath: raw.manifestPath === null
            ? null
            : isAbsolute(raw.manifestPath)
                ? raw.manifestPath
                : resolve(raw.manifestPath)
    };
};
const buildBlockingResult = (input) => ({
    ...input,
    blocking: true
});
export const buildIdentityPreflightError = (result) => {
    const details = {
        ability_id: "runtime.identity_preflight",
        stage: "execution",
        reason: result.failureReason,
        identity_binding_state: result.identityBindingState,
        browser_mode: result.mode,
        browser_version: result.browserVersion,
        browser_path: result.browserPath,
        extension_id: result.binding?.extensionId ?? null,
        native_host_name: result.binding?.nativeHostName ?? null,
        browser_channel: result.binding?.browserChannel ?? null,
        manifest_path: result.manifestPath,
        manifest_source: result.manifestSource,
        expected_origin: result.expectedOrigin,
        allowed_origins: result.allowedOrigins,
        launcher_path: result.installDiagnostics.launcherPath,
        launcher_exists: result.installDiagnostics.launcherExists,
        launcher_executable: result.installDiagnostics.launcherExecutable,
        bundle_runtime_path: result.installDiagnostics.bundleRuntimePath,
        bundle_runtime_exists: result.installDiagnostics.bundleRuntimeExists,
        launcher_profile_root: result.installDiagnostics.launcherProfileRoot,
        expected_profile_root: result.installDiagnostics.expectedProfileRoot,
        profile_root_matches: result.installDiagnostics.profileRootMatches,
        legacy_launcher_detected: result.installDiagnostics.legacyLauncherDetected
    };
    if (result.failureReason === "BOOTSTRAP_PENDING") {
        return new CliError("ERR_RUNTIME_BOOTSTRAP_PENDING", "identity preflight 已通过，但 persistent extension bootstrap 尚未实现", { details, retryable: false });
    }
    if (result.identityBindingState === "missing") {
        return new CliError("ERR_RUNTIME_IDENTITY_NOT_BOUND", "official Chrome persistent extension identity 未绑定，无法进入运行阶段", { details, retryable: false });
    }
    return new CliError("ERR_RUNTIME_IDENTITY_MISMATCH", "official Chrome persistent extension identity 不一致，已阻止继续执行", { details, retryable: false });
};
export const runIdentityPreflight = async (input) => {
    let browserPath = null;
    let browserVersion = null;
    try {
        const truth = await identityPreflightAdapters.resolvePreferredBrowserVersionTruthSource(input.params);
        browserPath = truth.executablePath;
        browserVersion = truth.browserVersion;
    }
    catch (error) {
        if (!(error instanceof BrowserLaunchError)) {
            return {
                mode: "load_extension",
                browserPath: null,
                browserVersion: null,
                identityBindingState: "not_applicable",
                binding: null,
                manifestPath: null,
                manifestSource: null,
                expectedOrigin: null,
                allowedOrigins: [],
                installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
                blocking: false,
                failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
            };
        }
        return {
            mode: "load_extension",
            browserPath: null,
            browserVersion: null,
            identityBindingState: "not_applicable",
            binding: null,
            manifestPath: null,
            manifestSource: null,
            expectedOrigin: null,
            allowedOrigins: [],
            installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
            blocking: false,
            failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
        };
    }
    if (!identityPreflightAdapters.isUnsupportedBrandedChromeForExtensions(browserVersion)) {
        return {
            mode: "load_extension",
            browserPath,
            browserVersion,
            identityBindingState: "not_applicable",
            binding: null,
            manifestPath: null,
            manifestSource: null,
            expectedOrigin: null,
            allowedOrigins: [],
            installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
            blocking: false,
            failureReason: "IDENTITY_PREFLIGHT_NOT_REQUIRED"
        };
    }
    const binding = parsePersistentExtensionBindingFromParams(input.params) ??
        parsePersistentExtensionBindingFromMeta(input.meta);
    if (!binding) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "missing",
            binding: null,
            manifestPath: null,
            manifestSource: null,
            expectedOrigin: null,
            allowedOrigins: [],
            installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
            failureReason: "IDENTITY_BINDING_MISSING"
        });
    }
    const expectedOrigin = `chrome-extension://${binding.extensionId}/`;
    const profileDir = asNonEmptyString(input.meta?.profileDir) ?? asNonEmptyString(input.profileDir);
    const resolvedBrowserChannel = inferResolvedBrowserChannel({
        browserPath,
        browserVersion
    });
    if (resolvedBrowserChannel !== null && binding.browserChannel !== resolvedBrowserChannel) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding,
            manifestPath: binding.manifestPath,
            manifestSource: binding.manifestPath ? "binding" : null,
            expectedOrigin,
            allowedOrigins: [],
            installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
            failureReason: "IDENTITY_BINDING_CONFLICT"
        });
    }
    const manifestResolution = await resolveManifestPathForBinding(binding, {
        execFile: identityPreflightAdapters.execFile,
        platform: identityPreflightAdapters.platform
    });
    const manifestPath = manifestResolution.manifestPath;
    if (manifestPath === null) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding,
            manifestPath: null,
            manifestSource: manifestResolution.manifestSource,
            expectedOrigin,
            allowedOrigins: [],
            installDiagnostics: EMPTY_INSTALL_DIAGNOSTICS,
            failureReason: "IDENTITY_MANIFEST_MISSING"
        });
    }
    const manifest = await readNativeHostManifest(manifestPath);
    const installDiagnostics = await resolveInstallDiagnostics({
        manifest,
        manifestPath,
        profileDir: profileDir ?? null,
        platform: identityPreflightAdapters.platform()
    });
    if (!manifest) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            manifestSource: manifestResolution.manifestSource,
            expectedOrigin,
            allowedOrigins: [],
            installDiagnostics,
            failureReason: "IDENTITY_MANIFEST_MISSING"
        });
    }
    const installBroken = installDiagnostics.launcherExists === false ||
        installDiagnostics.launcherExecutable === false ||
        installDiagnostics.legacyLauncherDetected === true ||
        installDiagnostics.profileRootMatches === false ||
        (installDiagnostics.launcherExists === true &&
            installDiagnostics.bundleRuntimePath !== null &&
            installDiagnostics.bundleRuntimeExists === false);
    if (installBroken) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            manifestSource: manifestResolution.manifestSource,
            expectedOrigin,
            allowedOrigins: manifest.allowed_origins,
            installDiagnostics,
            failureReason: "IDENTITY_MANIFEST_MISSING"
        });
    }
    if (manifest.name !== binding.nativeHostName) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            manifestSource: manifestResolution.manifestSource,
            expectedOrigin,
            allowedOrigins: manifest.allowed_origins,
            installDiagnostics,
            failureReason: "IDENTITY_NATIVE_HOST_NAME_MISMATCH"
        });
    }
    if (!manifest.allowed_origins.includes(expectedOrigin)) {
        return buildBlockingResult({
            mode: "official_chrome_persistent_extension",
            browserPath,
            browserVersion,
            identityBindingState: "mismatch",
            binding: {
                ...binding,
                manifestPath
            },
            manifestPath,
            manifestSource: manifestResolution.manifestSource,
            expectedOrigin,
            allowedOrigins: manifest.allowed_origins,
            installDiagnostics,
            failureReason: "IDENTITY_ALLOWED_ORIGIN_MISSING"
        });
    }
    if (profileDir) {
        const extensionState = await resolveProfileExtensionState(profileDir, binding.extensionId);
        if (extensionState !== "enabled") {
            return buildBlockingResult({
                mode: "official_chrome_persistent_extension",
                browserPath,
                browserVersion,
                identityBindingState: "missing",
                binding: {
                    ...binding,
                    manifestPath
                },
                manifestPath,
                manifestSource: manifestResolution.manifestSource,
                expectedOrigin,
                allowedOrigins: manifest.allowed_origins,
                installDiagnostics,
                failureReason: "IDENTITY_BINDING_MISSING"
            });
        }
    }
    return {
        mode: "official_chrome_persistent_extension",
        browserPath,
        browserVersion,
        identityBindingState: "bound",
        binding: {
            ...binding,
            manifestPath
        },
        manifestPath,
        manifestSource: manifestResolution.manifestSource,
        expectedOrigin,
        allowedOrigins: manifest.allowed_origins,
        installDiagnostics,
        blocking: false,
        failureReason: "IDENTITY_PREFLIGHT_PASSED"
    };
};
